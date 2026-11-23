import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { pool, migrationPool } from "../src/db";
import { redis } from "../src/server/redis";
import { signWebhookPayload, verifyWebhookSignature } from "../src/server/webhooks/signer";
import { validateOutboundUrl, SSRFBlockedError, isPrivateOrBlockedIP } from "../src/server/webhooks/ssrf";
import { sendOutboundWebhook } from "../src/server/webhooks/sender";
import { WebhookDeliveryWorker, calculateRetryDelay } from "../src/workers/webhook-worker";
import { webhooksDeliverQueue, WebhookDeliverJobData } from "../src/server/queues";
import { signSession } from "../src/server/auth/session";
import { POST as handleReplaySingle } from "../src/app/api/v1/deliveries/[id]/replay/route";
import { POST as handleReplayBulk } from "../src/app/api/v1/dlq/replay-bulk/route";
import { DELETE as handlePurgeDlq } from "../src/app/api/v1/dlq/purge/route";

describe("Phase 3: Webhook Delivery Engine, HMAC, SSRF & DLQ Suite", () => {
  let mockServer: http.Server;
  let mockServerPort: number;
  let mockServerUrl: string;
  let testOrgId: string;
  let testEndpointId: string;
  let testEventId: string;
  let testSecret: string;
  let adminSessionCookie: string;

  beforeAll(async () => {
    process.env.ALLOW_TEST_LOOPBACK = "true";

    // 1. Setup local mock HTTP server that can return 502, hang, or stream large body
    mockServer = http.createServer((req, res) => {
      const url = req.url || "/";

      if (url.startsWith("/502")) {
        res.writeHead(502, { "Content-Type": "text/plain", "Server": "cloudflare" });
        res.end("502 Bad Gateway");
      } else if (url.startsWith("/huge")) {
        // Return 100 KB of text
        res.writeHead(200, { "Content-Type": "text/plain" });
        const chunk = "A".repeat(10 * 1024); // 10 KB
        for (let i = 0; i < 10; i++) {
          res.write(chunk);
        }
        res.end();
      } else if (url.startsWith("/slow")) {
        // Hang indefinitely
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
    testEndpointId = `ep_test_${Date.now()}`;
    testEventId = `evt_test_${Date.now()}`;
    testSecret = "whsec_01J9XK3M7Q8N2A4B6C8D0E2F4";

    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, $3, 6000)`,
      [testOrgId, `org-webhooks-${Date.now()}`, "Webhook Test Org"]
    );

    await migrationPool.query(
      `INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret, is_active)
       VALUES ($1, $2, $3, ARRAY['payment.*'], $4, true)`,
      [testEndpointId, testOrgId, `${mockServerUrl}/502`, testSecret]
    );

    await migrationPool.query(
      `INSERT INTO events (id, org_id, event_name, payload, ingest_latency_ms, status_code)
       VALUES ($1, $2, 'payment.failed', '{"amount": 5000}', 5.0, 202)`,
      [testEventId, testOrgId]
    );

    adminSessionCookie = signSession({
      userId: crypto.randomUUID(),
      orgId: testOrgId,
      role: "ADMIN",
      email: "admin@test.com",
      name: "Admin User",
    });
  });

  afterAll(async () => {
    delete process.env.ALLOW_TEST_LOOPBACK;
    await new Promise((resolve) => mockServer.close(resolve));
    await webhooksDeliverQueue.pause();
    await webhooksDeliverQueue.drain();
    await new Promise((r) => setTimeout(r, 100));
    await migrationPool.query("DELETE FROM organizations WHERE id = $1", [testOrgId]);
    await pool.end();
    await migrationPool.end();
    redis.disconnect();
  });

  describe("HMAC-SHA256 Payload Signing & Verification Protocol", () => {
    it("signs payload matching X-Webhook-Signature specification", () => {
      const payload = JSON.stringify({ id: "evt_123", amount: 4900 });
      const now = Math.floor(Date.now() / 1000);
      const result = signWebhookPayload(testSecret, payload, now);

      expect(result.timestamp).toBe(now);
      expect(result.signatureHeader).toMatch(new RegExp(`^t=${now},v1=[a-f0-9]{64}$`));
      expect(result.signaturePrefix).toMatch(/^sha256=[a-f0-9]{10}\.\.\.$/);

      // Verify signature validates cleanly
      const isValid = verifyWebhookSignature(testSecret, payload, result.signatureHeader, 300);
      expect(isValid).toBe(true);
    });

    it("rejects tampered payloads and tampered signatures", () => {
      const payload = JSON.stringify({ id: "evt_123", amount: 4900 });
      const tamperedPayload = JSON.stringify({ id: "evt_123", amount: 999999 });
      const result = signWebhookPayload(testSecret, payload);

      // Tampered payload
      expect(verifyWebhookSignature(testSecret, tamperedPayload, result.signatureHeader)).toBe(false);

      // Tampered secret
      expect(verifyWebhookSignature("whsec_wrong_secret", payload, result.signatureHeader)).toBe(false);

      // Tampered signature string
      const tamperedHeader = result.signatureHeader.slice(0, -4) + "0000";
      expect(verifyWebhookSignature(testSecret, payload, tamperedHeader)).toBe(false);
    });

    it("rejects signatures outside the 300s freshness window (replay attack prevention)", () => {
      const payload = JSON.stringify({ id: "evt_freshness" });
      const staleTimestamp = Math.floor(Date.now() / 1000) - 305; // 305 seconds old
      const result = signWebhookPayload(testSecret, payload, staleTimestamp);

      expect(verifyWebhookSignature(testSecret, payload, result.signatureHeader, 300)).toBe(false);
    });
  });

  describe("Outbound SSRF Protection & IP Validation", () => {
    it("identifies private and metadata IP ranges correctly", () => {
      expect(isPrivateOrBlockedIP("127.0.0.1")).toBe(true);
      expect(isPrivateOrBlockedIP("127.0.0.5")).toBe(true);
      expect(isPrivateOrBlockedIP("10.0.0.1")).toBe(true);
      expect(isPrivateOrBlockedIP("169.254.169.254")).toBe(true);
      expect(isPrivateOrBlockedIP("169.254.1.1")).toBe(true);
      expect(isPrivateOrBlockedIP("172.16.0.1")).toBe(true);
      expect(isPrivateOrBlockedIP("172.31.255.255")).toBe(true);
      expect(isPrivateOrBlockedIP("192.168.1.1")).toBe(true);
      expect(isPrivateOrBlockedIP("::1")).toBe(true);
      expect(isPrivateOrBlockedIP("fc00::1")).toBe(true);
      expect(isPrivateOrBlockedIP("fe80::1")).toBe(true);

      // Public IPs allowed
      expect(isPrivateOrBlockedIP("8.8.8.8")).toBe(false);
      expect(isPrivateOrBlockedIP("1.1.1.1")).toBe(false);
    });

    it("strictly blocks SSRF attempts to private hosts and metadata endpoints", async () => {
      // Loopback
      await expect(validateOutboundUrl("http://127.0.0.1/hook")).rejects.toThrow(SSRFBlockedError);
      await expect(validateOutboundUrl("http://localhost:8080")).rejects.toThrow(SSRFBlockedError);

      // AWS/GCP cloud metadata
      await expect(
        validateOutboundUrl("http://169.254.169.254/latest/meta-data/")
      ).rejects.toThrow(SSRFBlockedError);

      // Private LAN
      await expect(validateOutboundUrl("http://10.0.0.1:9000/internal")).rejects.toThrow(SSRFBlockedError);
      await expect(validateOutboundUrl("http://192.168.0.1/admin")).rejects.toThrow(SSRFBlockedError);

      // Non-HTTP schemes
      await expect(validateOutboundUrl("ftp://example.com/files")).rejects.toThrow(SSRFBlockedError);
      await expect(validateOutboundUrl("file:///etc/passwd")).rejects.toThrow(SSRFBlockedError);
    });
  });

  describe("Outbound Sender: Truncation & Strict Timeouts", () => {
    it("truncates response bodies larger than 64 KB and sets responseTruncated: true", async () => {
      const deliveryId = `dlv_trunc_${Date.now()}`;
      const result = await sendOutboundWebhook({
        deliveryId,
        endpointUrl: `${mockServerUrl}/huge`,
        rawJsonBody: JSON.stringify({ ping: true }),
        signingSecret: testSecret,
        allowLoopback: true,
      });

      expect(result.statusCode).toBe(200);
      expect(result.responseTruncated).toBe(true);
      expect(Buffer.byteLength(result.responseBody, "utf8")).toBe(64 * 1024);
    });

    it("enforces strict timeouts, recording status_code = null and is_timeout = true", async () => {
      const deliveryId = `dlv_timeout_${Date.now()}`;
      const result = await sendOutboundWebhook({
        deliveryId,
        endpointUrl: `${mockServerUrl}/slow`,
        rawJsonBody: JSON.stringify({ ping: true }),
        signingSecret: testSecret,
        timeoutMs: 100, // Short timeout for test speed
        allowLoopback: true,
      });

      expect(result.statusCode).toBeNull();
      expect(result.isTimeout).toBe(true);
      expect(result.responseBody).toContain("TIMEOUT");
    });
  });

  describe("Exponential Backoff & Dead Letter Queue (DLQ) Lifecycle", () => {
    it("computes backoff delay with ±15% jitter per specification", () => {
      // Attempt 2: base 10,000ms -> [8500, 11500]
      const delay2 = calculateRetryDelay(2);
      expect(delay2).toBeGreaterThanOrEqual(8500);
      expect(delay2).toBeLessThanOrEqual(11500);

      // Attempt 3: base 60,000ms -> [51000, 69000]
      const delay3 = calculateRetryDelay(3);
      expect(delay3).toBeGreaterThanOrEqual(51000);
      expect(delay3).toBeLessThanOrEqual(69000);

      // Attempt 5: base 1,800,000ms -> [1530000, 2070000]
      const delay5 = calculateRetryDelay(5);
      expect(delay5).toBeGreaterThanOrEqual(1530000);
      expect(delay5).toBeLessThanOrEqual(2070000);

      // Beyond attempt 5 returns null
      expect(calculateRetryDelay(6)).toBeNull();
    });

    it("handles 502 failure on Attempt 1: logs attempt and transitions to RETRYING", async () => {
      const worker = new WebhookDeliveryWorker(false);
      const deliveryId = `dlv_fail_1_${Date.now()}`;

      const jobData: WebhookDeliverJobData = {
        deliveryId,
        orgId: testOrgId,
        endpointId: testEndpointId,
        endpointUrl: `${mockServerUrl}/502`,
        eventName: "payment.failed",
        eventId: testEventId,
        payload: { amount: 5000 },
        signingSecret: testSecret,
        attemptNumber: 1,
        maxAttempts: 5,
        trigger: "auto",
      };

      await worker.handleJob(jobData);

      // Verify row in webhook_deliveries is RETRYING
      const dlvRes = await migrationPool.query(
        "SELECT state, last_status_code, attempt_count, next_retry_at FROM webhook_deliveries WHERE id = $1",
        [deliveryId]
      );
      expect(dlvRes.rows.length).toBe(1);
      expect(dlvRes.rows[0].state).toBe("RETRYING");
      expect(dlvRes.rows[0].last_status_code).toBe(502);
      expect(dlvRes.rows[0].attempt_count).toBe(1);
      expect(dlvRes.rows[0].next_retry_at).not.toBeNull();

      // Verify attempt is recorded in webhook_attempts
      const attRes = await migrationPool.query(
        "SELECT attempt_number, status_code, trigger, response_body FROM webhook_attempts WHERE delivery_id = $1",
        [deliveryId]
      );
      expect(attRes.rows.length).toBe(1);
      expect(attRes.rows[0].attempt_number).toBe(1);
      expect(attRes.rows[0].status_code).toBe(502);
      expect(attRes.rows[0].trigger).toBe("auto");

      await worker.stop();
    });

    it("moves delivery to DLQ upon exhausting max attempts (Attempt 5)", async () => {
      const worker = new WebhookDeliveryWorker(false);
      const deliveryId = `dlv_dlq_${Date.now()}`;

      const jobData: WebhookDeliverJobData = {
        deliveryId,
        orgId: testOrgId,
        endpointId: testEndpointId,
        endpointUrl: `${mockServerUrl}/502`,
        eventName: "payment.failed",
        eventId: testEventId,
        payload: { amount: 5000 },
        signingSecret: testSecret,
        attemptNumber: 5, // Last attempt
        maxAttempts: 5,
        trigger: "auto",
      };

      await worker.handleJob(jobData);

      // Verify row in webhook_deliveries is DLQ
      const dlvRes = await migrationPool.query(
        "SELECT state, last_status_code, attempt_count, next_retry_at FROM webhook_deliveries WHERE id = $1",
        [deliveryId]
      );
      expect(dlvRes.rows.length).toBe(1);
      expect(dlvRes.rows[0].state).toBe("DLQ");
      expect(dlvRes.rows[0].attempt_count).toBe(5);
      expect(dlvRes.rows[0].next_retry_at).toBeNull();

      await worker.stop();
    });
  });

  describe("Manual & Bulk Replay + DLQ Purge API Routes", () => {
    it("POST /api/v1/deliveries/:id/replay queues a manual retry and sets state to QUEUED", async () => {
      const deliveryId = `dlv_replay_test_${Date.now()}`;

      // Insert an existing DLQ delivery
      await migrationPool.query(
        `INSERT INTO webhook_deliveries (id, org_id, endpoint_id, event_name, endpoint_url, state, attempt_count, max_attempts, signature_prefix)
         VALUES ($1, $2, $3, 'payment.failed', $4, 'DLQ', 5, 5, 'sha256=1234')`,
        [deliveryId, testOrgId, testEndpointId, `${mockServerUrl}/502`]
      );

      const req = new NextRequest(`http://localhost:3000/api/v1/deliveries/${deliveryId}/replay`, {
        method: "POST",
        headers: {
          Cookie: `session_token=${adminSessionCookie}`,
        },
      });

      const res = await handleReplaySingle(req, { params: Promise.resolve({ id: deliveryId }) });
      expect(res.status).toBe(202);

      const json = await res.json();
      expect(json.queued).toBe(true);

      // Check delivery state transitioned to QUEUED
      const dlv = await migrationPool.query(
        "SELECT state FROM webhook_deliveries WHERE id = $1",
        [deliveryId]
      );
      expect(dlv.rows[0].state).toBe("QUEUED");
    });

    it("POST /api/v1/dlq/replay-bulk replayed multiple deliveries idempotently", async () => {
      const dlv1 = `dlv_bulk_1_${Date.now()}`;
      const dlv2 = `dlv_bulk_2_${Date.now()}`;

      await migrationPool.query(
        `INSERT INTO webhook_deliveries (id, org_id, endpoint_id, event_name, endpoint_url, state, attempt_count, max_attempts, signature_prefix)
         VALUES ($1, $3, $4, 'event.1', $5, 'DLQ', 5, 5, 'sha256=1111'),
                ($2, $3, $4, 'event.2', $5, 'DLQ', 5, 5, 'sha256=2222')`,
        [dlv1, dlv2, testOrgId, testEndpointId, `${mockServerUrl}/502`]
      );

      const req = new NextRequest("http://localhost:3000/api/v1/dlq/replay-bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session_token=${adminSessionCookie}`,
        },
        body: JSON.stringify({ delivery_ids: [dlv1, dlv2] }),
      });

      const res = await handleReplayBulk(req);
      expect(res.status).toBe(202);

      const json = await res.json();
      expect(json.replayed_count).toBe(2);
      expect(json.queued).toBe(true);
    });

    it("DELETE /api/v1/dlq/purge permanently deletes DLQ deliveries", async () => {
      const dlvPurge = `dlv_purge_${Date.now()}`;

      await migrationPool.query(
        `INSERT INTO webhook_deliveries (id, org_id, endpoint_id, event_name, endpoint_url, state, attempt_count, max_attempts, signature_prefix)
         VALUES ($1, $2, $3, 'purge.event', $4, 'DLQ', 5, 5, 'sha256=purge')`,
        [dlvPurge, testOrgId, testEndpointId, `${mockServerUrl}/502`]
      );

      const req = new NextRequest("http://localhost:3000/api/v1/dlq/purge", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session_token=${adminSessionCookie}`,
        },
        body: JSON.stringify({ delivery_ids: [dlvPurge] }),
      });

      const res = await handlePurgeDlq(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.purged_count).toBe(1);

      // Verify row is gone
      const check = await migrationPool.query(
        "SELECT id FROM webhook_deliveries WHERE id = $1",
        [dlvPurge]
      );
      expect(check.rows.length).toBe(0);
    });
  });
});
