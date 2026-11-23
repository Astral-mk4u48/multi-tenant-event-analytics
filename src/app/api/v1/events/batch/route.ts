import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { verifyApiKey } from "@/server/crypto";
import { checkRateLimit, recordRateLimitDrop } from "@/server/ratelimit/limiter";
import { eventsIngestQueue, IngestJobData } from "@/server/queues";
import { logger } from "@/server/logger";
import { redisCircuitBreaker, RedisCircuitBreakerOpenError } from "@/server/redis-circuit-breaker";

export const dynamic = "force-dynamic";

const batchItemSchema = z.object({
  event: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9._-]+$/),
  data: z.record(z.unknown()),
  idempotency_key: z.string().max(128).optional(),
  timestamp: z.string().datetime().optional(),
});

const batchSchema = z.array(batchItemSchema).min(1).max(100);

const MAX_BATCH_BYTES = 1024 * 1024; // 1 MB

export async function POST(req: NextRequest) {
  const startTime = performance.now();

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Unauthorized: Missing or invalid Bearer token" },
      { status: 401 }
    );
  }

  const rawKey = authHeader.slice(7).trim();
  const apiKey = await verifyApiKey(rawKey, "INGEST");
  if (!apiKey) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or revoked API key" },
      { status: 401 }
    );
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BATCH_BYTES) {
    return NextResponse.json(
      { error: "Payload Too Large: Batch exceeds 1 MB limit" },
      { status: 413 }
    );
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch (err) {
    logger.error({ err }, "Failed to read batch request body");
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (Buffer.byteLength(bodyText, "utf8") > MAX_BATCH_BYTES) {
    return NextResponse.json(
      { error: "Payload Too Large: Batch exceeds 1 MB limit" },
      { status: 413 }
    );
  }

  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const validation = batchSchema.safeParse(jsonBody);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid batch schema", details: validation.error.format() },
      { status: 422 }
    );
  }

  const items = validation.data;

  // Rate limiting against shared budget
  const rateLimit = await checkRateLimit(apiKey.orgId, apiKey.rateLimitRpm);

  const rateLimitHeaders: Record<string, string> = {
    "X-RateLimit-Limit": rateLimit.limit.toString(),
    "X-RateLimit-Remaining": rateLimit.remaining.toString(),
    "X-RateLimit-Reset": rateLimit.resetSeconds.toString(),
  };

  const latencyMs = Math.round((performance.now() - startTime) * 10) / 10;

  if (!rateLimit.allowed) {
    rateLimitHeaders["Retry-After"] = rateLimit.retryAfterSeconds.toString();
    recordRateLimitDrop(apiKey.orgId, items[0].event, latencyMs);
    return NextResponse.json(
      { error: "Too Many Requests", retry_after: rateLimit.retryAfterSeconds },
      { status: 429, headers: rateLimitHeaders }
    );
  }

  const eventIds: string[] = [];
  const jobs: { name: string; data: IngestJobData }[] = [];

  for (const item of items) {
    const timestampPart = Date.now().toString(36);
    const randomPart = crypto.randomBytes(6).toString("hex");
    const eventId = `evt_${timestampPart}${randomPart}`;
    eventIds.push(eventId);

    jobs.push({
      name: "ingest",
      data: {
        id: eventId,
        orgId: apiKey.orgId,
        eventName: item.event,
        idempotencyKey: item.idempotency_key ?? null,
        payload: item.data,
        ingestLatencyMs: latencyMs,
        statusCode: 202,
        createdAt: item.timestamp ?? new Date().toISOString(),
      },
    });
  }

  try {
    await redisCircuitBreaker.execute(() => eventsIngestQueue.addBulk(jobs));
  } catch (err) {
    if (err instanceof RedisCircuitBreakerOpenError) {
      logger.warn({ err }, "Batch ingestion rejected: Redis circuit breaker is OPEN");
      return NextResponse.json(
        {
          error: "Service Unavailable: Redis cluster unreachable (circuit breaker OPEN)",
          retry_after: err.retryAfter,
        },
        {
          status: 503,
          headers: {
            "Retry-After": err.retryAfter.toString(),
            ...rateLimitHeaders,
          },
        }
      );
    }

    logger.error({ err }, "Failed to bulk-enqueue events into BullMQ");
    return NextResponse.json(
      { error: "Internal Server Error: Ingestion queue unavailable" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ids: eventIds,
      count: eventIds.length,
      queued: true,
    },
    {
      status: 202,
      headers: rateLimitHeaders,
    }
  );
}
