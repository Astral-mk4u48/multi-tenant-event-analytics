import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";
import {
  RedisCircuitBreaker,
  RedisCircuitBreakerOpenError,
  redisCircuitBreaker,
} from "../src/server/redis-circuit-breaker";
import { checkRateLimit } from "../src/server/ratelimit/limiter";
import { POST as handlePostEvent } from "../src/app/api/v1/events/route";
import { GET as handleHealthz } from "../src/app/api/healthz/route";
import { migrationPool } from "../src/db";
import { hashApiKey } from "../src/server/crypto";

describe("v2 Issue #1: Redis Cluster Circuit Breaker Suite", () => {
  let breaker: RedisCircuitBreaker;

  beforeEach(() => {
    breaker = new RedisCircuitBreaker({
      failureThreshold: 3,
      cooldownMs: 200, // Short 200ms cooldown for fast test runs
      timeoutMs: 100,
    });
    redisCircuitBreaker.reset();
  });

  afterEach(() => {
    redisCircuitBreaker.reset();
    vi.restoreAllMocks();
  });

  it("executes operations cleanly and resets failure count when healthy in CLOSED state", async () => {
    expect(breaker.getState()).toBe("CLOSED");

    const result = await breaker.execute(async () => "redis_ok");
    expect(result).toBe("redis_ok");
    expect(breaker.getMetrics().failureCount).toBe(0);
  });

  it("trips from CLOSED to OPEN after 3 consecutive failures", async () => {
    const failingOp = async () => {
      throw new Error("ECONNREFUSED: Redis cluster node down");
    };

    // 1st failure
    await expect(breaker.execute(failingOp)).rejects.toThrow("ECONNREFUSED");
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getMetrics().failureCount).toBe(1);

    // 2nd failure
    await expect(breaker.execute(failingOp)).rejects.toThrow("ECONNREFUSED");
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getMetrics().failureCount).toBe(2);

    // 3rd failure: trips breaker to OPEN
    await expect(breaker.execute(failingOp)).rejects.toThrow("ECONNREFUSED");
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.getMetrics().failureCount).toBe(3);
    expect(breaker.getMetrics().nextAttemptTime).toBeGreaterThan(Date.now());

    // Subsequent call fails fast without invoking operation
    let operationCalled = false;
    await expect(
      breaker.execute(async () => {
        operationCalled = true;
        return "never_called";
      })
    ).rejects.toThrow(RedisCircuitBreakerOpenError);

    expect(operationCalled).toBe(false);
  });

  it("invokes fallback handler without throwing when circuit is OPEN", async () => {
    breaker.trip("Simulated outage");
    expect(breaker.getState()).toBe("OPEN");

    const result = await breaker.execute(
      async () => "redis_call",
      () => "graceful_fallback"
    );

    expect(result).toBe("graceful_fallback");
  });

  it("recovers from OPEN to HALF_OPEN after cooldown and resets to CLOSED on successful probe", async () => {
    breaker.trip("Simulated outage");
    expect(breaker.getState()).toBe("OPEN");

    // Wait for 200ms cooldown to expire
    await new Promise((resolve) => setTimeout(resolve, 220));

    expect(breaker.getState()).toBe("HALF_OPEN");

    // Probe operation succeeds
    const probeResult = await breaker.execute(async () => "probe_success");
    expect(probeResult).toBe("probe_success");

    // Breaker transitions back to CLOSED
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.getMetrics().failureCount).toBe(0);
  });

  it("re-trips to OPEN if a probe fails in HALF_OPEN state", async () => {
    breaker.trip("Simulated outage");

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 220));
    expect(breaker.getState()).toBe("HALF_OPEN");

    // Probe fails
    await expect(
      breaker.execute(async () => {
        throw new Error("Cluster still unreachable");
      })
    ).rejects.toThrow("Cluster still unreachable");

    // Immediately re-tripped back to OPEN
    expect(breaker.getState()).toBe("OPEN");
  });

  it("rate limiter fails open gracefully when Redis circuit breaker is OPEN", async () => {
    redisCircuitBreaker.trip("Redis partition");

    const rlResult = await checkRateLimit("test-org-circuit", 100);
    expect(rlResult.allowed).toBe(true);
    expect(rlResult.remaining).toBe(1);
    expect(rlResult.retryAfterSeconds).toBe(0);
  });

  it("health check reports circuit_open and returns 503 when Redis breaker is OPEN", async () => {
    redisCircuitBreaker.trip("Redis failure");

    const res = await handleHealthz();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe("unhealthy");
    expect(json.checks.redis).toBe("circuit_open");
  });

  it("events API returns 503 Service Unavailable with Retry-After when Redis breaker is OPEN", async () => {
    const testOrgId = crypto.randomUUID();
    const rawApiKey = `pk_live_${crypto.randomBytes(16).toString("hex")}`;
    const keyHash = hashApiKey(rawApiKey);

    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, $3, 6000)`,
      [testOrgId, `org-breaker-${Date.now()}`, "Breaker Test Org"]
    );

    await migrationPool.query(
      `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scope)
       VALUES ($1, $2, 'Breaker Key', 'pk_live_test', $3, 'INGEST')`,
      [`key_brk_${Date.now()}`, testOrgId, keyHash]
    );

    // Trip global breaker
    redisCircuitBreaker.trip("Redis cluster down");

    const req = new NextRequest("http://localhost:3000/api/v1/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rawApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: "user.login",
        data: { userId: "usr_123" },
      }),
    });

    const res = await handlePostEvent(req);
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBeDefined();
    const json = await res.json();
    expect(json.error).toContain("circuit breaker OPEN");
    expect(json.retry_after).toBeGreaterThan(0);
  });
});
