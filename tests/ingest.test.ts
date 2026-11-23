import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { pool, migrationPool } from "../src/db";
import { redis } from "../src/server/redis";
import { generateApiKey } from "../src/server/crypto";
import { checkRateLimit } from "../src/server/ratelimit/limiter";
import { matchesEventPattern, matchesAnyPattern } from "../src/server/webhooks/matcher";
import { IngestBatchWorker } from "../src/workers/ingest-worker";
import { POST as handleSingleEvent } from "../src/app/api/v1/events/route";
import { POST as handleBatchEvents } from "../src/app/api/v1/events/batch/route";
import { eventsIngestQueue, IngestJobData } from "../src/server/queues";

describe("Phase 2: Ingestion Pipeline, Rate Limiter & Batch Worker Suite", () => {
  let testOrgId: string;
  let testKey: ReturnType<typeof generateApiKey>;

  beforeAll(async () => {
    testOrgId = crypto.randomUUID();
    testKey = generateApiKey("INGEST");

    // Seed test org with rate limit of 50 RPM for concurrency test
    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, $3, 50)`,
      [testOrgId, `org-rate-${Date.now()}`, "Rate Limit Test Org"]
    );

    await migrationPool.query(
      `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scope)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [testKey.id, testOrgId, "Ingest Key", testKey.prefix, testKey.keyHash, "INGEST"]
    );
  });

  afterAll(async () => {
    await migrationPool.query("DELETE FROM organizations WHERE id = $1", [testOrgId]);
    await eventsIngestQueue.drain();
    await pool.end();
    await migrationPool.end();
    redis.disconnect();
  });

  describe("Deterministic Dot-Segment Pattern Matcher", () => {
    it("correctly matches wildcards, exact segments, and hierarchies", () => {
      expect(matchesEventPattern("*", "payment.succeeded")).toBe(true);
      expect(matchesEventPattern("payment.*", "payment.succeeded")).toBe(true);
      expect(matchesEventPattern("payment.*", "payment.failed")).toBe(true);
      expect(matchesEventPattern("payment.*", "user.created")).toBe(false);
      expect(matchesEventPattern("payment.*", "payment.invoice.paid")).toBe(false);
      expect(matchesEventPattern("payment.**", "payment.invoice.paid")).toBe(true);
      expect(matchesEventPattern("order.created", "order.created")).toBe(true);
      expect(matchesEventPattern("order.created", "order.deleted")).toBe(false);

      expect(
        matchesAnyPattern(["user.*", "payment.succeeded"], "payment.succeeded")
      ).toBe(true);
      expect(
        matchesAnyPattern(["user.*", "auth.login"], "payment.failed")
      ).toBe(false);
    });
  });

  describe("Atomic Redis Lua Sliding-Window Rate Limiter Concurrency", () => {
    it("handles concurrent requests atomically: exactly limit succeed and excess return retry-after", async () => {
      const testLimitOrg = crypto.randomUUID();
      const limit = 25;
      const totalRequests = limit + 20; // 45 concurrent requests

      // Clear any prior rate limit keys
      await redis.del(`rl:{${testLimitOrg}}`);

      // Fire limit + 20 concurrent requests simultaneously via Promise.all
      const promises = Array.from({ length: totalRequests }).map(() =>
        checkRateLimit(testLimitOrg, limit, 60000)
      );

      const results = await Promise.all(promises);

      const allowedCount = results.filter((r) => r.allowed).length;
      const blockedCount = results.filter((r) => !r.allowed).length;

      expect(allowedCount).toBe(limit);
      expect(blockedCount).toBe(20);

      // Verify blocked responses include valid positive retry-after
      const blocked = results.filter((r) => !r.allowed);
      for (const b of blocked) {
        expect(b.retryAfterSeconds).toBeGreaterThan(0);
        expect(b.remaining).toBe(0);
      }
    });
  });

  describe("POST /api/v1/events Endpoint Contract", () => {
    it("rejects unauthorized requests with 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "test.event", data: {} }),
      });
      const res = await handleSingleEvent(req);
      expect(res.status).toBe(401);
    });

    it("rejects oversized payloads (> 256 KB) with 413 Payload Too Large", async () => {
      const hugeData = "x".repeat(300 * 1024); // 300 KB string
      const req = new NextRequest("http://localhost:3000/api/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testKey.rawKey}`,
        },
        body: JSON.stringify({ event: "test.huge", data: { huge: hugeData } }),
      });
      const res = await handleSingleEvent(req);
      expect(res.status).toBe(413);
    });

    it("rejects invalid event schema with 422 Unprocessable Entity", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testKey.rawKey}`,
        },
        body: JSON.stringify({ event: "INVALID EVENT NAME WITH SPACES!", data: {} }),
      });
      const res = await handleSingleEvent(req);
      expect(res.status).toBe(422);
    });

    it("accepts valid event with 202 Accepted, returns event ID, and sets rate-limit headers", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testKey.rawKey}`,
        },
        body: JSON.stringify({
          event: "checkout.completed",
          data: { orderId: "ord_123", amount: 49.99 },
          idempotency_key: `idemp_${Date.now()}`,
        }),
      });
      const res = await handleSingleEvent(req);
      expect(res.status).toBe(202);

      const json = await res.json();
      expect(json.id).toMatch(/^evt_/);
      expect(json.queued).toBe(true);

      expect(res.headers.get("X-RateLimit-Limit")).toBe("50");
      expect(res.headers.get("X-RateLimit-Remaining")).not.toBeNull();
    });
  });

  describe("POST /api/v1/events/batch Endpoint", () => {
    it("accepts a batch of events with 202 and returns generated IDs", async () => {
      const batchPayload = [
        { event: "item.viewed", data: { itemId: "item_1" } },
        { event: "item.added", data: { itemId: "item_1", qty: 2 } },
      ];

      const req = new NextRequest("http://localhost:3000/api/v1/events/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testKey.rawKey}`,
        },
        body: JSON.stringify(batchPayload),
      });

      const res = await handleBatchEvents(req);
      expect(res.status).toBe(202);

      const json = await res.json();
      expect(json.count).toBe(2);
      expect(json.ids.length).toBe(2);
      expect(json.queued).toBe(true);
    });
  });

  describe("Batch Buffer Worker Flusher", () => {
    it("bulk-inserts 100 events into PostgreSQL in a single multi-row SQL query", async () => {
      const batchWorker = new IngestBatchWorker();
      // Pause automatic consumer so we can test flushBuffer directly
      await batchWorker.worker.pause();

      const items: IngestJobData[] = [];
      const timestamp = new Date().toISOString();

      for (let i = 0; i < 100; i++) {
        items.push({
          id: `evt_batch_${Date.now()}_${i}`,
          orgId: testOrgId,
          eventName: "analytics.ping",
          idempotencyKey: `idemp_batch_${Date.now()}_${i}`,
          payload: { index: i, timestamp },
          ingestLatencyMs: 5.2,
          statusCode: 202,
          createdAt: timestamp,
        });
      }

      // Feed items into worker buffer
      // @ts-expect-error private access for whitebox testing
      batchWorker.buffer.push(...items);

      // Flush buffer directly
      const flushedCount = await batchWorker.flushBuffer();
      expect(flushedCount).toBe(100);

      // Verify 100 rows were inserted in DB
      const dbCheck = await migrationPool.query(
        "SELECT COUNT(*)::int as count FROM events WHERE org_id = $1 AND event_name = 'analytics.ping'",
        [testOrgId]
      );
      expect(dbCheck.rows[0].count).toBe(100);

      await batchWorker.stop();
    });
  });
});
