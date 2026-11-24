import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { redis } from "@/server/redis";
import { GET as healthCheck } from "@/app/api/healthz/route";
import { POST as testDispatchRoute } from "@/app/api/v1/events/test-dispatch/route";
import { NextRequest } from "next/server";
import { signSession } from "@/server/auth/session";
import { migrationPool } from "@/db";
import crypto from "crypto";

describe("Milestone D: Onboarding Playground, Test Dispatch, and Worker Heartbeats", () => {
  let testOrgId: string;
  let testUserId: string;
  let sessionToken: string;

  beforeAll(async () => {
    testOrgId = crypto.randomUUID();
    testUserId = crypto.randomUUID();

    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, 'Playground Test Org', 6000)`,
      [testOrgId, `playground-org-${Date.now()}`]
    );

    await migrationPool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, $2, 'Playground User')`,
      [testUserId, `playground-${Date.now()}@example.com`]
    );

    await migrationPool.query(
      `INSERT INTO org_memberships (org_id, user_id, role)
       VALUES ($1, $2, 'OWNER')`,
      [testOrgId, testUserId]
    );

    sessionToken = signSession({
      userId: testUserId,
      orgId: testOrgId,
      role: "OWNER",
      email: "playground@example.com",
      name: "Playground User",
    });
  });

  afterAll(async () => {
    await migrationPool.query(`DELETE FROM organizations WHERE id = $1`, [testOrgId]);
    await migrationPool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  });

  describe("Worker Heartbeat Signals & Healthz Endpoint", () => {
    it("reports inactive worker state and 503 when heartbeats are missing", async () => {
      const existsSpy = vi.spyOn(redis, "exists").mockResolvedValue(0 as any);

      const res = await healthCheck();
      existsSpy.mockRestore();

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.status).toBe("degraded");
      expect(json.checks.ingestWorker).toBe("inactive");
      expect(json.checks.webhookWorker).toBe("inactive");
    });

    it("reports 200 OK and active workers when heartbeats are present", async () => {
      await redis.set("worker:heartbeat:ingest", Date.now().toString(), "EX", 30);
      await redis.set("worker:heartbeat:webhook", Date.now().toString(), "EX", 30);

      const res = await healthCheck();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("healthy");
      expect(json.checks.database).toBe("up");
      expect(json.checks.redis).toBe("up");
      expect(json.checks.ingestWorker).toBe("active");
      expect(json.checks.webhookWorker).toBe("active");
    });
  });

  describe("In-Browser Test Dispatch API", () => {
    it("rejects unauthenticated test event dispatches with 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/events/test-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "payment.succeeded",
          payload: { amount: 5000 },
        }),
      });

      const res = await testDispatchRoute(req);
      expect(res.status).toBe(401);
    });

    it("successfully dispatches test event with HTTP 202 Accepted for authenticated sessions", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/events/test-dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session_token=${sessionToken}`,
        },
        body: JSON.stringify({
          eventType: "order.placed",
          payload: { order_id: "ord_test_99", total: 120 },
        }),
      });

      const res = await testDispatchRoute(req);
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.eventId).toMatch(/^evt_test_/);
      expect(json.eventName).toBe("order.placed");
    });
  });
});
