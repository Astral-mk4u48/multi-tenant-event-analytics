import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { pool, migrationPool } from "../src/db";
import { redis } from "../src/server/redis";
import { signSession } from "../src/server/auth/session";
import { GET as getAnalyticsOverview } from "../src/app/api/v1/analytics/overview/route";
import { GET as getDeliveries } from "../src/app/api/v1/deliveries/route";
import { GET as getDeliveryById } from "../src/app/api/v1/deliveries/[id]/route";
import { GET as getWebhooks, POST as createWebhook } from "../src/app/api/v1/webhooks/route";
import { PATCH as updateWebhook, DELETE as deleteWebhook } from "../src/app/api/v1/webhooks/[id]/route";
import { POST as revealSecret } from "../src/app/api/v1/webhooks/[id]/secret/route";
import { GET as getKeys, POST as createKey } from "../src/app/api/v1/keys/route";
import { DELETE as revokeKey } from "../src/app/api/v1/keys/[id]/route";
import { GET as getTeam, POST as inviteMember } from "../src/app/api/v1/team/route";

describe("Phase 4: Analytics Overview, Management APIs & Tenant Isolation", () => {
  let tenantAId: string;
  let tenantBId: string;
  let adminSessionA: string;
  let adminSessionB: string;
  let viewerSessionA: string;

  beforeAll(async () => {
    tenantAId = crypto.randomUUID();
    tenantBId = crypto.randomUUID();

    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, $3, 6000), ($4, $5, $6, 3000)`,
      [tenantAId, `org-analytics-a-${Date.now()}`, "Tenant A", tenantBId, `org-analytics-b-${Date.now()}`, "Tenant B"]
    );

    adminSessionA = signSession({
      userId: crypto.randomUUID(),
      orgId: tenantAId,
      role: "ADMIN",
      email: "admin-a@test.com",
      name: "Admin A",
    });

    viewerSessionA = signSession({
      userId: crypto.randomUUID(),
      orgId: tenantAId,
      role: "VIEWER",
      email: "viewer-a@test.com",
      name: "Viewer A",
    });

    adminSessionB = signSession({
      userId: crypto.randomUUID(),
      orgId: tenantBId,
      role: "ADMIN",
      email: "admin-b@test.com",
      name: "Admin B",
    });

    // Seed events for Tenant A
    for (let i = 0; i < 20; i++) {
      await migrationPool.query(
        `INSERT INTO events (id, org_id, event_name, payload, ingest_latency_ms, status_code, created_at)
         VALUES ($1, $2, $3, '{}', $4, $5, NOW() - ($6 || ' minutes')::interval)`,
        [
          `evt_seed_${Date.now()}_${i}`,
          tenantAId,
          i % 3 === 0 ? "payment.success" : i % 3 === 1 ? "user.signup" : "order.created",
          10.0 + (i % 5),
          i === 19 ? 429 : 202,
          i * 2,
        ]
      );
    }

    // Seed deliveries for Tenant A
    for (let i = 0; i < 15; i++) {
      const dlvId = `dlv_seed_${Date.now()}_${i}`;
      const state = i === 0 ? "DLQ" : i % 2 === 0 ? "DELIVERED" : "RETRYING";
      const statusCode = state === "DELIVERED" ? 200 : state === "DLQ" ? 502 : 429;

      await migrationPool.query(
        `INSERT INTO webhook_deliveries (
           id, org_id, event_name, endpoint_url, state, last_status_code,
           last_latency_ms, attempt_count, max_attempts, signature_prefix, created_at
         ) VALUES ($1, $2, $3, 'https://example.com/webhook', $4, $5, 120, 1, 5, 'sha256=1234', NOW() - ($6 || ' seconds')::interval)`,
        [dlvId, tenantAId, "payment.success", state, statusCode, (15 - i) * 10]
      );

      // Seed attempt for delivery
      await migrationPool.query(
        `INSERT INTO webhook_attempts (
           id, org_id, delivery_id, attempt_number, trigger, status_code, latency_ms,
           request_headers, request_body, response_headers, response_body, created_at
         ) VALUES ($1, $2, $3, 1, 'auto', $4, 120, '{"content-type":"application/json"}', '{"id":"evt_1"}', '{"server":"test"}', 'OK', NOW())`,
        [`att_seed_${Date.now()}_${i}`, tenantAId, dlvId, statusCode]
      );
    }
  });

  afterAll(async () => {
    await migrationPool.query("DELETE FROM organizations WHERE id IN ($1, $2)", [tenantAId, tenantBId]);
    await pool.end();
    await migrationPool.end();
    redis.disconnect();
  });

  describe("Analytics Overview SQL API (GET /api/v1/analytics/overview)", () => {
    it("computes KPIs, deltas, time series volume, and top event breakdown", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/analytics/overview?range=24h", {
        headers: { Cookie: `session_token=${adminSessionA}` },
      });

      const res = await getAnalyticsOverview(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.range).toBe("24h");
      expect(json.kpis).toBeDefined();

      // Events Ingested KPI
      expect(json.kpis.eventsIngested.value).toBe(19); // 19 of 20 had status 202
      expect(json.kpis.eventsIngested.deltaLabel).toContain("vs prev 24h");

      // Delivery Success Rate KPI
      expect(typeof json.kpis.deliverySuccessRate.value).toBe("number");
      expect(json.kpis.deliverySuccessRate.value).toBeGreaterThan(0);

      // p99 Ingestion Latency KPI
      expect(json.kpis.p99LatencyMs.value).toBeGreaterThan(0);

      // DLQ Count KPI
      expect(json.kpis.dlqCount.value).toBe(1);

      // Volume Series
      expect(Array.isArray(json.volumeSeries)).toBe(true);
      expect(json.volumeSeries.length).toBeGreaterThan(0);
      expect(json.volumeSeries[0]).toHaveProperty("ingested");
      expect(json.volumeSeries[0]).toHaveProperty("rateLimited");

      // Top Event Types Breakdown
      expect(Array.isArray(json.topEventTypes)).toBe(true);
      expect(json.topEventTypes.length).toBeGreaterThan(0);
      expect(json.topEventTypes[0]).toHaveProperty("name");
      expect(json.topEventTypes[0]).toHaveProperty("count");
      expect(json.topEventTypes[0]).toHaveProperty("percent");
    });
  });

  describe("Delivery Logs Cursor Pagination (GET /api/v1/deliveries)", () => {
    it("paginates deliveries using cursor-based pagination", async () => {
      // 1. Fetch Page 1 (limit = 10)
      const reqPage1 = new NextRequest("http://localhost:3000/api/v1/deliveries?limit=10", {
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const resPage1 = await getDeliveries(reqPage1);
      expect(resPage1.status).toBe(200);

      const json1 = await resPage1.json();
      expect(json1.data.length).toBe(10);
      expect(json1.has_more).toBe(true);
      expect(json1.next_cursor).not.toBeNull();

      // 2. Fetch Page 2 using next_cursor
      const reqPage2 = new NextRequest(
        `http://localhost:3000/api/v1/deliveries?limit=10&cursor=${encodeURIComponent(json1.next_cursor)}`,
        { headers: { Cookie: `session_token=${adminSessionA}` } }
      );
      const resPage2 = await getDeliveries(reqPage2);
      expect(resPage2.status).toBe(200);

      const json2 = await resPage2.json();
      expect(json2.data.length).toBe(5); // Remaining 5 items
      expect(json2.has_more).toBe(false);
      expect(json2.next_cursor).toBeNull();
    });

    it("filters deliveries by state and status_class", async () => {
      const reqState = new NextRequest("http://localhost:3000/api/v1/deliveries?state=DLQ", {
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const resState = await getDeliveries(reqState);
      const jsonState = await resState.json();
      expect(jsonState.data.length).toBe(1);
      expect(jsonState.data[0].state).toBe("DLQ");

      const reqStatus = new NextRequest("http://localhost:3000/api/v1/deliveries?status_class=2xx", {
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const resStatus = await getDeliveries(reqStatus);
      const jsonStatus = await resStatus.json();
      for (const item of jsonStatus.data) {
        expect(item.status_code).toBeGreaterThanOrEqual(200);
        expect(item.status_code).toBeLessThan(300);
      }
    });
  });

  describe("Payload Inspector Detail Contract (GET /api/v1/deliveries/:id)", () => {
    it("returns full inspector schema matching Section 5.2 contract", async () => {
      // Find one delivery ID
      const listRes = await migrationPool.query(
        "SELECT id FROM webhook_deliveries WHERE org_id = $1 LIMIT 1",
        [tenantAId]
      );
      const deliveryId = listRes.rows[0].id;

      const req = new NextRequest(`http://localhost:3000/api/v1/deliveries/${deliveryId}`, {
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const res = await getDeliveryById(req, { params: Promise.resolve({ id: deliveryId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.id).toBe(deliveryId);
      expect(json.signature_prefix).toBeDefined();
      expect(json.latest_attempt).toBeDefined();
      expect(json.latest_attempt.request_headers).toBeDefined();
      expect(json.latest_attempt.response_body).toBeDefined();
      expect(Array.isArray(json.attempts)).toBe(true);
      expect(json.attempts.length).toBeGreaterThan(0);
    });

    it("strictly isolates deliveries: Tenant B cannot access Tenant A delivery", async () => {
      const listRes = await migrationPool.query(
        "SELECT id FROM webhook_deliveries WHERE org_id = $1 LIMIT 1",
        [tenantAId]
      );
      const deliveryId = listRes.rows[0].id;

      const req = new NextRequest(`http://localhost:3000/api/v1/deliveries/${deliveryId}`, {
        headers: { Cookie: `session_token=${adminSessionB}` },
      });
      const res = await getDeliveryById(req, { params: Promise.resolve({ id: deliveryId }) });
      expect(res.status).toBe(404);
    });
  });

  describe("Webhook Endpoints CRUD & Secret Reveal", () => {
    let createdEndpointId: string;
    let plaintextSecret: string;

    it("POST /api/v1/webhooks creates endpoint and returns signing secret once", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session_token=${adminSessionA}`,
        },
        body: JSON.stringify({
          url: "https://api.partner.com/webhooks/billing",
          subscribed_events: ["invoice.*", "payment.*"],
        }),
      });

      const res = await createWebhook(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      createdEndpointId = json.endpoint.id;
      plaintextSecret = json.endpoint.signing_secret;

      expect(createdEndpointId).toMatch(/^ep_/);
      expect(plaintextSecret).toMatch(/^whsec_/);
    });

    it("GET /api/v1/webhooks lists endpoints with masked signing secret", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/webhooks", {
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const res = await getWebhooks(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      const ep = json.endpoints.find((e: any) => e.id === createdEndpointId);
      expect(ep).toBeDefined();
      expect(ep.signing_secret_masked).toBe("whsec_••••••••••••");
    });

    it("POST /api/v1/webhooks/:id/secret reveals decrypted secret to ADMIN but rejects VIEWER", async () => {
      // VIEWER gets 403
      const reqViewer = new NextRequest(`http://localhost:3000/api/v1/webhooks/${createdEndpointId}/secret`, {
        method: "POST",
        headers: { Cookie: `session_token=${viewerSessionA}` },
      });
      const resViewer = await revealSecret(reqViewer, { params: Promise.resolve({ id: createdEndpointId }) });
      expect(resViewer.status).toBe(403);

      // ADMIN gets decrypted plaintext secret
      const reqAdmin = new NextRequest(`http://localhost:3000/api/v1/webhooks/${createdEndpointId}/secret`, {
        method: "POST",
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const resAdmin = await revealSecret(reqAdmin, { params: Promise.resolve({ id: createdEndpointId }) });
      expect(resAdmin.status).toBe(200);

      const json = await resAdmin.json();
      expect(json.signing_secret).toBe(plaintextSecret);
      expect(json.reveal_duration_seconds).toBe(10);
    });

    it("PATCH /api/v1/webhooks/:id toggles active state and DELETE removes it", async () => {
      // Disable
      const reqToggle = new NextRequest(`http://localhost:3000/api/v1/webhooks/${createdEndpointId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session_token=${adminSessionA}`,
        },
        body: JSON.stringify({ is_active: false }),
      });
      const resToggle = await updateWebhook(reqToggle, { params: Promise.resolve({ id: createdEndpointId }) });
      expect(resToggle.status).toBe(200);
      const jsonToggle = await resToggle.json();
      expect(jsonToggle.endpoint.is_active).toBe(false);

      // Delete
      const reqDel = new NextRequest(`http://localhost:3000/api/v1/webhooks/${createdEndpointId}`, {
        method: "DELETE",
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const resDel = await deleteWebhook(reqDel, { params: Promise.resolve({ id: createdEndpointId }) });
      expect(resDel.status).toBe(200);
    });
  });

  describe("API Keys & RBAC Team Management APIs", () => {
    let mintedKeyId: string;

    it("POST /api/v1/keys creates scoped key and DELETE revokes it", async () => {
      // 1. Create Key
      const reqCreate = new NextRequest("http://localhost:3000/api/v1/keys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session_token=${adminSessionA}`,
        },
        body: JSON.stringify({ name: "CI Ingest Key", scope: "INGEST" }),
      });
      const resCreate = await createKey(reqCreate);
      expect(resCreate.status).toBe(201);
      const jsonCreate = await resCreate.json();
      mintedKeyId = jsonCreate.key.id;
      expect(jsonCreate.key.raw_key).toMatch(/^pk_live_/);

      // 2. List Keys
      const reqList = new NextRequest("http://localhost:3000/api/v1/keys", {
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const resList = await getKeys(reqList);
      expect(resList.status).toBe(200);
      const jsonList = await resList.json();
      const found = jsonList.keys.find((k: any) => k.id === mintedKeyId);
      expect(found).toBeDefined();

      // 3. Revoke Key
      const reqRevoke = new NextRequest(`http://localhost:3000/api/v1/keys/${mintedKeyId}`, {
        method: "DELETE",
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const resRevoke = await revokeKey(reqRevoke, { params: Promise.resolve({ id: mintedKeyId }) });
      expect(resRevoke.status).toBe(200);
    });

    it("Team management: invite member and list team", async () => {
      const inviteReq = new NextRequest("http://localhost:3000/api/v1/team", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session_token=${adminSessionA}`,
        },
        body: JSON.stringify({
          email: `developer-${Date.now()}@acme.com`,
          name: "Dev User",
          role: "VIEWER",
        }),
      });
      const inviteRes = await inviteMember(inviteReq);
      expect(inviteRes.status).toBe(201);

      const teamReq = new NextRequest("http://localhost:3000/api/v1/team", {
        headers: { Cookie: `session_token=${adminSessionA}` },
      });
      const teamRes = await getTeam(teamReq);
      expect(teamRes.status).toBe(200);
      const teamJson = await teamRes.json();
      expect(teamJson.members.length).toBeGreaterThan(0);
    });
  });
});
