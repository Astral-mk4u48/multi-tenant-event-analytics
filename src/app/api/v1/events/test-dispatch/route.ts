import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { resolveAuth } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { webhooksDeliverQueue, WebhookDeliverJobData } from "@/server/queues";
import { matchesAnyPattern } from "@/server/webhooks/matcher";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const testDispatchSchema = z.object({
  eventType: z.string().min(1).optional(),
  event_name: z.string().min(1).optional(),
  payload: z.record(z.unknown()),
}).refine((d) => d.eventType || d.event_name, {
  message: "eventType or event_name required",
});

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = testDispatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed: eventType and payload are required" },
      { status: 400 }
    );
  }

  const eventName = parsed.data.eventType || parsed.data.event_name || "test.event";
  const payload = parsed.data.payload;
  const eventId = `evt_test_${crypto.randomBytes(8).toString("hex")}`;

  try {
    // 1. Insert into events table
    await migrationPool.query(
      `INSERT INTO events (id, org_id, event_name, payload, ingest_latency_ms, status_code, created_at)
       VALUES ($1, $2, $3, $4, 1.2, 202, NOW())`,
      [eventId, auth.orgId, eventName, JSON.stringify(payload)]
    );

    // 2. Fetch active webhook endpoints matching event type
    const epRes = await migrationPool.query(
      `SELECT id, url, signing_secret, subscribed_events
       FROM webhook_endpoints
       WHERE org_id = $1 AND status = 'ACTIVE'`,
      [auth.orgId]
    );

    const endpoints = epRes.rows;
    const matchingEndpoints = endpoints.filter((ep) =>
      matchesAnyPattern(ep.subscribed_events || [], eventName)
    );

    // 3. Queue webhook delivery jobs for matching endpoints
    for (const ep of matchingEndpoints) {
      const deliveryId = `del_test_${crypto.randomBytes(8).toString("hex")}`;
      await migrationPool.query(
        `INSERT INTO webhook_deliveries (
           id, org_id, event_id, endpoint_id, event_name, endpoint_url,
           state, attempt_count, max_attempts, signature_prefix, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', 0, 5, 'whsec_', NOW(), NOW())`,
        [deliveryId, auth.orgId, eventId, ep.id, eventName, ep.url]
      );

      const jobData: WebhookDeliverJobData = {
        deliveryId,
        orgId: auth.orgId,
        endpointId: ep.id,
        endpointUrl: ep.url,
        eventName,
        eventId,
        payload,
        signingSecret: ep.signing_secret || "whsec_sandbox_default",
        attemptNumber: 1,
        maxAttempts: 5,
        trigger: "manual",
      };

      await webhooksDeliverQueue.add("deliver", jobData);
    }

    logger.info(
      { orgId: auth.orgId, eventId, eventName, matched: matchingEndpoints.length },
      "Test event dispatched successfully"
    );

    return NextResponse.json(
      {
        success: true,
        eventId,
        eventName,
        deliveredCount: matchingEndpoints.length,
        endpointsTriggered: matchingEndpoints.map((ep) => ep.url),
      },
      { status: 202 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Dispatch failed";
    logger.error({ err, orgId: auth.orgId }, "Failed to dispatch test event");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
