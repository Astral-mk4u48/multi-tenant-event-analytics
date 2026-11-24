import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrationPool } from "@/db";
import { runMigrations } from "@/db/migrate";
import { POST as signupRoute } from "@/app/api/v1/auth/signup/route";
import { POST as demoAuthRoute } from "@/app/api/v1/auth/demo/route";
import { POST as createKeyRoute, GET as getKeysRoute } from "@/app/api/v1/keys/route";
import { POST as createWebhookRoute, GET as getWebhooksRoute } from "@/app/api/v1/webhooks/route";
import { POST as ingestEventRoute } from "@/app/api/v1/events/route";
import { GET as getDlqRoute } from "@/app/api/v1/dlq/route";
import { NextRequest } from "next/server";
import crypto from "crypto";

describe("Layer 4: End-to-End Company Journey & Multi-Tenant Onboarding", () => {
  const companySlug = `acme-journey-${Date.now()}`;
  const companyEmail = `founder-${Date.now()}@acme-corp.io`;
  let sessionCookie: string;
  let companyOrgId: string;
  let rawIngestionKey: string;
  let webhookEndpointId: string;

  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    if (companyOrgId) {
      await migrationPool.query(`DELETE FROM organizations WHERE id = $1`, [companyOrgId]);
    }
  });

  it("Step 1: Signs up a new company user and creates isolated workspace", async () => {
    const signupReq = new NextRequest("http://localhost:3000/api/v1/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Pavan Founder",
        email: companyEmail,
        password: "SuperSecretPassword123!",
        orgName: "Acme Journey Corp",
        orgSlug: companySlug,
      }),
    });

    const res = await signupRoute(signupReq);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.redirect).toBe("/dashboard");
    expect(json.org.id).toBeDefined();

    companyOrgId = json.org.id;

    // Extract issued session cookie from response
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("session_token=");
    const match = setCookie.match(/session_token=([^;]+)/);
    expect(match).not.toBeNull();
    sessionCookie = match![1];

    // Verify database record has user as OWNER
    const memberRes = await migrationPool.query(
      `SELECT role FROM org_memberships WHERE org_id = $1 AND user_id = $2`,
      [companyOrgId, json.user.id]
    );
    expect(memberRes.rows[0].role).toBe("OWNER");
  });

  it("Step 2: Authenticated company owner generates pk_live_ API key", async () => {
    const keyReq = new NextRequest("http://localhost:3000/api/v1/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `session_token=${sessionCookie}`,
      },
      body: JSON.stringify({
        name: "Primary Ingestion Key",
        scope: "INGEST",
      }),
    });

    const res = await createKeyRoute(keyReq);
    expect(res.status).toBe(201);
    const json = await res.json();

    expect(json.id).toBeDefined();
    expect(json.rawKey).toMatch(/^pk_live_/);
    rawIngestionKey = json.rawKey;

    // Verify key is listed in GET /api/v1/keys
    const listReq = new NextRequest("http://localhost:3000/api/v1/keys", {
      headers: { Cookie: `session_token=${sessionCookie}` },
    });
    const listRes = await getKeysRoute(listReq);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    const found = listJson.keys.find((k: { id: string }) => k.id === json.id);
    expect(found).toBeDefined();
  });

  it("Step 3: Registers a webhook endpoint and dispatches a live event using the new API key", async () => {
    // 1. Register Webhook Endpoint
    const epReq = new NextRequest("http://localhost:3000/api/v1/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `session_token=${sessionCookie}`,
      },
      body: JSON.stringify({
        url: "https://api.acme-corp.io/webhooks/listener",
        description: "Primary Event Ingestion Hook",
        events: ["order.*", "payment.*"],
      }),
    });

    const epRes = await createWebhookRoute(epReq);
    expect(epRes.status).toBe(201);
    const epJson = await epRes.json();
    webhookEndpointId = epJson.endpoint.id;
    expect(webhookEndpointId).toBeDefined();

    // 2. Dispatch event with Bearer API Key
    const eventPayload = {
      order_id: "ord_e2e_001",
      customer: "Alpha Corp",
      amount_cents: 89000,
    };

    const ingestReq = new NextRequest("http://localhost:3000/api/v1/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rawIngestionKey}`,
      },
      body: JSON.stringify({
        event: "order.created",
        data: eventPayload,
      }),
    });

    const ingestRes = await ingestEventRoute(ingestReq);
    expect(ingestRes.status).toBe(202);
    const ingestJson = await ingestRes.json();
    expect(ingestJson.status).toBe("queued");
    expect(ingestJson.event_id).toMatch(/^evt_/);
  });

  it("Step 4: Loads DLQ and Webhooks endpoints without exceptions", async () => {
    const dlqReq = new NextRequest("http://localhost:3000/api/v1/dlq", {
      headers: { Cookie: `session_token=${sessionCookie}` },
    });
    const dlqRes = await getDlqRoute(dlqReq);
    expect(dlqRes.status).toBe(200);
    const dlqJson = await dlqRes.json();
    expect(Array.isArray(dlqJson.items)).toBe(true);
    expect(dlqJson.totalCount).toBeDefined();

    const whReq = new NextRequest("http://localhost:3000/api/v1/webhooks", {
      headers: { Cookie: `session_token=${sessionCookie}` },
    });
    const whRes = await getWebhooksRoute(whReq);
    expect(whRes.status).toBe(200);
    const whJson = await whRes.json();
    expect(Array.isArray(whJson.endpoints)).toBe(true);
    expect(whJson.endpoints.length).toBeGreaterThan(0);
  });

  it("Step 5: Sign out and switch to Demo Workspace with zero data leakage", async () => {
    // 1. Authenticate into Demo Workspace
    const demoReq = new NextRequest("http://localhost:3000/api/v1/auth/demo", {
      method: "POST",
    });
    const demoRes = await demoAuthRoute(demoReq);
    expect(demoRes.status).toBe(200);

    const demoCookieHeader = demoRes.headers.get("set-cookie") || "";
    const demoCookie = demoCookieHeader.match(/session_token=([^;]+)/)![1];

    // 2. Query webhooks under Demo Workspace session
    const demoWhReq = new NextRequest("http://localhost:3000/api/v1/webhooks", {
      headers: { Cookie: `session_token=${demoCookie}` },
    });
    const demoWhRes = await getWebhooksRoute(demoWhReq);
    expect(demoWhRes.status).toBe(200);
    const demoWhJson = await demoWhRes.json();

    // Verify company's endpoint is NOT visible under demo session (RLS isolation)
    const leakedEp = demoWhJson.endpoints.find((ep: { id: string }) => ep.id === webhookEndpointId);
    expect(leakedEp).toBeUndefined();
  });
});
