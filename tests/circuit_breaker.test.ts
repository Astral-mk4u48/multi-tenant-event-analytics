import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { migrationPool } from "../src/db";
import { WebhookDeliveryWorker } from "../src/workers/webhook-worker";
import { signSession } from "../src/server/auth/session";
import { POST as handleResumeEndpoint } from "../src/app/api/v1/webhooks/[id]/resume/route";
import { GET as handleListWebhooks } from "../src/app/api/v1/webhooks/route";

describe("v2 Issue #4: Webhook Circuit Breaker & Health Scoring Suite", () => {
  let mockServer: http.Server;
  let mockServerPort: number;
  let mockServerUrl: string;
  let testOrgId: string;
  let testEndpointId: string;
  let testEventId: string;
  let adminSessionCookie: string;
  let webhookWorker: WebhookDeliveryWorker;

  beforeAll(async () => {
    process.env.ALLOW_TEST_LOOPBACK = "true";

    // Setup mock HTTP server that returns 502 on /fail and 200 on /success
    mockServer = http.createServer((req, res) => {
      if (req.url?.startsWith("/fail")) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Upstream service error" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      }
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address();
        if (typeof addr === "object" && addr) {
          mockServerPort = addr.port;
          mockServerUrl = `http://127.0.0.1:${mockServerPort}`;
        }
        resolve();
      });
    });

    testOrgId = crypto.randomUUID();
    testEndpointId = `ep_cb_${Date.now()}`;
    testEventId = `evt_cb_${Date.now()}`;

    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, $3, 6000)`,
      [testOrgId, `org-circuit-${Date.now()}`, "Circuit Breaker Test Org"]
    );

    await migrationPool.query(
      `INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret, is_active, status)
       VALUES ($1, $2, $3, ARRAY['order.*'], 'whsec_testsecret1234567890abcdef', true, 'ACTIVE')`,
      [testEndpointId, testOrgId, `${mockServerUrl}/fail`]
    );

    await migrationPool.query(
      `INSERT INTO events (id, org_id, event_name, payload, ingest_latency_ms, status_code)
       VALUES ($1, $2, 'order.created', '{"order_id": 999}', 4.2, 202)`,
      [testEventId, testOrgId]
    );

    adminSessionCookie = signSession({
      userId: crypto.randomUUID(),
      orgId: testOrgId,
      role: "ADMIN",
      email: "admin@circuit-breaker.internal",
      name: "Admin User",
    });

    webhookWorker = new WebhookDeliveryWorker(false);
  });

  afterAll(async () => {
    if (webhookWorker) {
      await webhookWorker.stop();
    }
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });

  it("calculates sliding-window health score and opens circuit after 5 consecutive 5xx failures", async () => {
    // Dispatch 5 consecutive failing delivery attempts to trigger auto-pause
    for (let i = 1; i <= 5; i++) {
      const deliveryId = `dlv_fail_${i}_${Date.now()}`;
      await migrationPool.query(
        `INSERT INTO webhook_deliveries (id, org_id, endpoint_id, event_id, event_name, endpoint_url, state, attempt_count, max_attempts, signature_prefix)
         VALUES ($1, $2, $3, $4, 'order.created', $5, 'QUEUED', 0, 5, 'sha256=123')`,
        [deliveryId, testOrgId, testEndpointId, testEventId, `${mockServerUrl}/fail`]
      );

      await webhookWorker.handleJob({
        deliveryId,
        orgId: testOrgId,
        endpointId: testEndpointId,
        endpointUrl: `${mockServerUrl}/fail`,
        eventName: "order.created",
        eventId: testEventId,
        payload: { attempt: i },
        signingSecret: "whsec_testsecret1234567890abcdef",
        attemptNumber: 1,
        maxAttempts: 5,
        trigger: "auto",
      });
    }

    // Inspect endpoint state in database
    const epRes = await migrationPool.query(
      `SELECT status, health_score, consecutive_failures, paused_at, paused_reason
       FROM webhook_endpoints WHERE id = $1`,
      [testEndpointId]
    );
    const ep = epRes.rows[0];

    expect(ep.status).toBe("PAUSED");
    expect(ep.consecutive_failures).toBe(5);
    expect(ep.paused_at).not.toBeNull();
    expect(ep.paused_reason).toContain("5 consecutive delivery failures");
    expect(Number(ep.health_score)).toBe(0);
  });

  it("skips dispatch and marks delivery as DLQ when endpoint is PAUSED", async () => {
    const deliveryId = `dlv_skipped_${Date.now()}`;
    await migrationPool.query(
      `INSERT INTO webhook_deliveries (id, org_id, endpoint_id, event_id, event_name, endpoint_url, state, attempt_count, max_attempts, signature_prefix)
       VALUES ($1, $2, $3, $4, 'order.created', $5, 'QUEUED', 0, 5, 'sha256=123')`,
      [deliveryId, testOrgId, testEndpointId, testEventId, `${mockServerUrl}/fail`]
    );

    await webhookWorker.handleJob({
      deliveryId,
      orgId: testOrgId,
      endpointId: testEndpointId,
      endpointUrl: `${mockServerUrl}/fail`,
      eventName: "order.created",
      eventId: testEventId,
      payload: { skipped: true },
      signingSecret: "whsec_testsecret1234567890abcdef",
      attemptNumber: 1,
      maxAttempts: 5,
      trigger: "auto",
    });

    const dlvRes = await migrationPool.query(
      `SELECT state FROM webhook_deliveries WHERE id = $1`,
      [deliveryId]
    );
    expect(dlvRes.rows[0].state).toBe("DLQ");
  });

  it("resumes endpoint and restores ACTIVE status via POST /api/v1/webhooks/[id]/resume", async () => {
    const resumeReq = new NextRequest(
      `http://localhost:3000/api/v1/webhooks/${testEndpointId}/resume`,
      {
        method: "POST",
        headers: {
          Cookie: `session_token=${adminSessionCookie}`,
        },
      }
    );

    const resumeRes = await handleResumeEndpoint(resumeReq, {
      params: Promise.resolve({ id: testEndpointId }),
    });

    expect(resumeRes.status).toBe(200);
    const resumeJson = await resumeRes.json();
    expect(resumeJson.success).toBe(true);
    expect(resumeJson.endpoint.status).toBe("ACTIVE");
    expect(Number(resumeJson.endpoint.health_score)).toBe(100);

    // Verify GET /api/v1/webhooks reflects the resumed state
    const listReq = new NextRequest("http://localhost:3000/api/v1/webhooks", {
      headers: {
        Cookie: `session_token=${adminSessionCookie}`,
      },
    });
    const listRes = await handleListWebhooks(listReq);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    const endpointData = listJson.data.find((e: { id: string }) => e.id === testEndpointId);
    expect(endpointData).toBeDefined();
    expect(endpointData.status).toBe("ACTIVE");
    expect(endpointData.consecutive_failures).toBe(0);
    expect(endpointData.paused_at).toBeNull();
  });

  it("updates health score positively when successful 2xx deliveries occur", async () => {
    // Point endpoint to success route and dispatch 10 successful deliveries
    await migrationPool.query(
      `UPDATE webhook_endpoints SET url = $1 WHERE id = $2`,
      [`${mockServerUrl}/success`, testEndpointId]
    );

    for (let i = 1; i <= 10; i++) {
      const deliveryId = `dlv_succ_${i}_${Date.now()}`;
      await migrationPool.query(
        `INSERT INTO webhook_deliveries (id, org_id, endpoint_id, event_id, event_name, endpoint_url, state, attempt_count, max_attempts, signature_prefix)
         VALUES ($1, $2, $3, $4, 'order.created', $5, 'QUEUED', 0, 5, 'sha256=123')`,
        [deliveryId, testOrgId, testEndpointId, testEventId, `${mockServerUrl}/success`]
      );

      await webhookWorker.handleJob({
        deliveryId,
        orgId: testOrgId,
        endpointId: testEndpointId,
        endpointUrl: `${mockServerUrl}/success`,
        eventName: "order.created",
        eventId: testEventId,
        payload: { successAttempt: i },
        signingSecret: "whsec_testsecret1234567890abcdef",
        attemptNumber: 1,
        maxAttempts: 5,
        trigger: "auto",
      });
    }

    const epRes = await migrationPool.query(
      `SELECT status, health_score, consecutive_failures FROM webhook_endpoints WHERE id = $1`,
      [testEndpointId]
    );
    const ep = epRes.rows[0];
    expect(ep.status).toBe("ACTIVE");
    expect(ep.consecutive_failures).toBe(0);
    expect(Number(ep.health_score)).toBeGreaterThanOrEqual(60);
  });
});
