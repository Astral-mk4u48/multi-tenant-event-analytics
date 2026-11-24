import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as demoAuthRoute } from "@/app/api/v1/auth/demo/route";
import { POST as createKeyRoute } from "@/app/api/v1/keys/route";
import { DELETE as revokeKeyRoute } from "@/app/api/v1/keys/[id]/route";
import { POST as createWebhookRoute } from "@/app/api/v1/webhooks/route";
import { PATCH as updateWebhookRoute, DELETE as deleteWebhookRoute } from "@/app/api/v1/webhooks/[id]/route";
import { DELETE as purgeDlqRoute } from "@/app/api/v1/dlq/purge/route";
import { POST as testDispatchRoute } from "@/app/api/v1/events/test-dispatch/route";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";

describe("Part 5: Public Demo Workspace Hardening", () => {
  let demoCookie: string;

  beforeAll(async () => {
    const demoReq = new NextRequest("http://localhost:3000/api/v1/auth/demo", {
      method: "POST",
    });
    const demoRes = await demoAuthRoute(demoReq);
    expect(demoRes.status).toBe(200);

    const setCookie = demoRes.headers.get("set-cookie") || "";
    const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    expect(match).toBeTruthy();
    demoCookie = match ? match[1] : "";
  });

  it("permits Send Test Event in demo workspace", async () => {
    const testReq = new NextRequest("http://localhost:3000/api/v1/events/test-dispatch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${SESSION_COOKIE_NAME}=${demoCookie}`,
      },
      body: JSON.stringify({
        eventName: "order.placed",
        payload: { amount_cents: 9900 },
      }),
    });

    const res = await testDispatchRoute(testReq);
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("strictly rejects API key creation with 403 in demo workspace", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${SESSION_COOKIE_NAME}=${demoCookie}`,
      },
      body: JSON.stringify({
        name: "malicious-key",
        scope: "INGEST",
      }),
    });

    const res = await createKeyRoute(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Demo workspace is read-only");
  });

  it("strictly rejects API key revocation with 403 in demo workspace", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/keys/key_sample_123", {
      method: "DELETE",
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${demoCookie}`,
      },
    });

    const res = await revokeKeyRoute(req, { params: Promise.resolve({ id: "key_sample_123" }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Demo workspace is read-only");
  });

  it("strictly rejects Webhook endpoint creation with 403 in demo workspace", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${SESSION_COOKIE_NAME}=${demoCookie}`,
      },
      body: JSON.stringify({
        url: "https://attacker.com/hook",
        subscribed_events: ["*"],
      }),
    });

    const res = await createWebhookRoute(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Demo workspace is read-only");
  });

  it("strictly rejects Webhook endpoint modification with 403 in demo workspace", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/webhooks/ep_sample_123", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${SESSION_COOKIE_NAME}=${demoCookie}`,
      },
      body: JSON.stringify({
        is_active: false,
      }),
    });

    const res = await updateWebhookRoute(req, { params: Promise.resolve({ id: "ep_sample_123" }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Demo workspace is read-only");
  });

  it("strictly rejects DLQ purge with 403 in demo workspace", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/dlq/purge", {
      method: "DELETE",
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=${demoCookie}`,
      },
    });

    const res = await purgeDlqRoute(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Demo workspace is read-only");
  });
});
