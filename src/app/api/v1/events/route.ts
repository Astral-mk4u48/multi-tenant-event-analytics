import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { verifyApiKey } from "@/server/crypto";
import { checkRateLimit, recordRateLimitDrop } from "@/server/ratelimit/limiter";
import { eventsIngestQueue, IngestJobData } from "@/server/queues";
import { logger } from "@/server/logger";
import { resolveAuth } from "@/server/auth/guard";
import { withTenant } from "@/db";
import { events } from "@/db/schema";
import { desc, eq, like, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

const singleEventSchema = z.object({
  event: z
    .string()
    .min(1, "Event name cannot be empty")
    .max(128, "Event name cannot exceed 128 chars")
    .regex(/^[a-z0-9._-]+$/, "Event name must match ^[a-z0-9._-]+$"),
  data: z.record(z.unknown()),
  idempotency_key: z.string().max(128).optional(),
  timestamp: z.string().datetime().optional(),
});

const MAX_PAYLOAD_BYTES = 256 * 1024; // 256 KB

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const search = url.searchParams.get("search");

  return withTenant(auth.orgId, async (tx) => {
    let query = tx
      .select({
        id: events.id,
        eventName: events.eventName,
        idempotencyKey: events.idempotencyKey,
        payload: events.payload,
        ingestLatencyMs: events.ingestLatencyMs,
        statusCode: events.statusCode,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(
        search
          ? and(eq(events.orgId, auth.orgId), like(events.eventName, `%${search}%`))
          : eq(events.orgId, auth.orgId)
      )
      .orderBy(desc(events.createdAt))
      .limit(limit);

    const rows = await query;
    return NextResponse.json({ data: rows });
  });
}

export async function POST(req: NextRequest) {
  const startTime = performance.now();

  // 1. Authenticate Bearer API Key
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

  // 2. Check Payload Cap (Hard 256 KB)
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "Payload Too Large: Single event exceeds 256 KB limit" },
      { status: 413 }
    );
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch (err) {
    logger.error({ err }, "Failed to read request body");
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (Buffer.byteLength(bodyText, "utf8") > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "Payload Too Large: Single event exceeds 256 KB limit" },
      { status: 413 }
    );
  }

  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // 3. Schema Validation
  const validation = singleEventSchema.safeParse(jsonBody);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid event schema", details: validation.error.format() },
      { status: 422 }
    );
  }

  const { event, data, idempotency_key, timestamp } = validation.data;

  // 4. Atomic Redis Lua Sliding-Window Rate Limiter
  const rateLimit = await checkRateLimit(apiKey.orgId, apiKey.rateLimitRpm);

  const rateLimitHeaders: Record<string, string> = {
    "X-RateLimit-Limit": rateLimit.limit.toString(),
    "X-RateLimit-Remaining": rateLimit.remaining.toString(),
    "X-RateLimit-Reset": rateLimit.resetSeconds.toString(),
  };

  const latencyMs = Math.round((performance.now() - startTime) * 10) / 10;

  if (!rateLimit.allowed) {
    rateLimitHeaders["Retry-After"] = rateLimit.retryAfterSeconds.toString();
    // Fire-and-forget 429 telemetry drop & Live Tail frame
    recordRateLimitDrop(apiKey.orgId, event, latencyMs);

    return NextResponse.json(
      {
        error: "Too Many Requests",
        retry_after: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: rateLimitHeaders,
      }
    );
  }

  // 5. Generate Sortable Prefixed ID: evt_...
  const timestampPart = Date.now().toString(36);
  const randomPart = crypto.randomBytes(6).toString("hex");
  const eventId = `evt_${timestampPart}${randomPart}`;

  const eventJobData: IngestJobData = {
    id: eventId,
    orgId: apiKey.orgId,
    eventName: event,
    idempotencyKey: idempotency_key ?? null,
    payload: data,
    ingestLatencyMs: latencyMs,
    statusCode: 202,
    createdAt: timestamp ?? new Date().toISOString(),
  };

  // 6. Enqueue raw event job into BullMQ ('events:ingest')
  try {
    await eventsIngestQueue.add("ingest", eventJobData, {
      jobId: idempotency_key ? `idemp_${apiKey.orgId}_${idempotency_key}` : undefined,
    });
  } catch (err) {
    logger.error({ err, eventId }, "Failed to enqueue event into BullMQ");
    return NextResponse.json(
      { error: "Internal Server Error: Ingestion queue unavailable" },
      { status: 500 }
    );
  }

  // 7. Return HTTP 202 Accepted immediately
  return NextResponse.json(
    {
      id: eventId,
      queued: true,
    },
    {
      status: 202,
      headers: rateLimitHeaders,
    }
  );
}
