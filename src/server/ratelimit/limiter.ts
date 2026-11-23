import crypto from "crypto";
import { redis } from "../redis";
import { logger } from "../logger";

// Atomic Redis Lua Sliding-Window Rate Limiter script per Section 3.2 of the specification
const SLIDING_WINDOW_LUA = `
-- KEYS[1] = "rl:{org_id}", ARGV[1] = now_ms, ARGV[2] = window_ms (60000),
-- ARGV[3] = limit, ARGV[4] = unique_req_id
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
local current = redis.call("ZCARD", key)

if current >= limit then
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local retry_after_ms = (tonumber(oldest[2]) + window) - now
  return {0, 0, math.max(math.ceil(retry_after_ms / 1000), 1)}
end

redis.call("ZADD", key, now, ARGV[4])
redis.call("PEXPIRE", key, window)
return {1, limit - current - 1, 0}
`;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetSeconds: number;
}

/**
 * Executes atomic sliding-window rate limit evaluation using Redis Lua script.
 * @param orgId Organization UUID
 * @param limit Requests per minute (default 6000)
 * @param windowMs Window size in milliseconds (default 60,000)
 */
export async function checkRateLimit(
  orgId: string,
  limit: number,
  windowMs = 60000
): Promise<RateLimitResult> {
  const now = Date.now();
  const reqId = crypto.randomUUID();
  const key = `rl:{${orgId}}`;

  try {
    const rawResult = (await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      now.toString(),
      windowMs.toString(),
      limit.toString(),
      reqId
    )) as [number, number, number];

    const allowed = rawResult[0] === 1;
    const remaining = rawResult[1];
    const retryAfterSeconds = rawResult[2];
    const resetSeconds = Math.ceil((now + windowMs) / 1000);

    return {
      allowed,
      limit,
      remaining: Math.max(remaining, 0),
      retryAfterSeconds,
      resetSeconds,
    };
  } catch (err) {
    logger.error({ err, orgId }, "Rate limiter Redis evaluation error; failing open to preserve ingestion");
    // Under extreme Redis failure, fail open to avoid dropping production telemetry
    return {
      allowed: true,
      limit,
      remaining: 1,
      retryAfterSeconds: 0,
      resetSeconds: Math.ceil((now + windowMs) / 1000),
    };
  }
}

/**
 * Emits lightweight 429 telemetry metrics to Redis and publishes a frame to Live Tail.
 */
export async function recordRateLimitDrop(
  orgId: string,
  eventName: string,
  latencyMs: number
): Promise<void> {
  const now = new Date();
  // Minute bucket formatted as YYYYMMDDHHmm
  const minuteBucket = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const metricKey = `metrics:429:{${orgId}}:${minuteBucket}`;

  try {
    const pipeline = redis.pipeline();
    pipeline.incr(metricKey);
    pipeline.expire(metricKey, 86400); // 24-hour retention

    // Publish frame to Live Tail subscriber channel
    const liveFrame = JSON.stringify({
      id: `evt_drop_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      event: eventName,
      status: 429,
      latency_ms: latencyMs,
      org_id: orgId,
      timestamp: now.toISOString(),
      method: "POST",
    });
    pipeline.publish(`live:{${orgId}}`, liveFrame);

    await pipeline.exec();
  } catch (err) {
    logger.warn({ err, orgId }, "Failed to record 429 rate limit telemetry");
  }
}
