import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { migrationPool } from "@/db";
import { webhooksDeliverQueue, WebhookDeliverJobData } from "@/server/queues";
import { resolveAuth } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/rbac";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const replayBatchSchema = z.object({
  deliveryIds: z.array(z.string()).min(1).max(100).optional(),
  delivery_ids: z.array(z.string()).min(1).max(100).optional(),
}).refine((data) => data.deliveryIds?.length || data.delivery_ids?.length, {
  message: "deliveryIds or delivery_ids must be provided with 1-100 IDs",
});

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(auth.role, "replay_webhooks")) {
    return NextResponse.json(
      { error: "Forbidden: VIEWER role cannot trigger DLQ replays" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = replayBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload: deliveryIds array required (1-100 items)" },
      { status: 422 }
    );
  }

  const ids = parsed.data.deliveryIds || parsed.data.delivery_ids || [];

  const query = `
    SELECT d.id, d.org_id, d.event_id, d.endpoint_id, d.event_name, d.endpoint_url,
           d.attempt_count, d.max_attempts,
           e.payload, ep.signing_secret
    FROM webhook_deliveries d
    LEFT JOIN events e ON e.id = d.event_id
    LEFT JOIN webhook_endpoints ep ON ep.id = d.endpoint_id
    WHERE d.id = ANY($1::text[]) AND d.org_id = $2
  `;

  const res = await migrationPool.query(query, [ids, auth.orgId]);
  const deliveries = res.rows;

  if (deliveries.length === 0) {
    return NextResponse.json(
      { message: "No matching deliveries found", replayed_count: 0 },
      { status: 200 }
    );
  }

  await migrationPool.query(
    `UPDATE webhook_deliveries
     SET state = 'QUEUED', updated_at = NOW()
     WHERE id = ANY($1::text[])`,
    [deliveries.map((d) => d.id)]
  );

  const jobs: { name: string; data: WebhookDeliverJobData }[] = deliveries.map((d) => ({
    name: "deliver",
    data: {
      deliveryId: d.id,
      orgId: d.org_id,
      endpointId: d.endpoint_id,
      endpointUrl: d.endpoint_url,
      eventName: d.event_name,
      eventId: d.event_id,
      payload: d.payload ?? {},
      signingSecret: d.signing_secret || "whsec_fallback",
      attemptNumber: (d.attempt_count || 0) + 1,
      maxAttempts: d.max_attempts || 5,
      trigger: "manual",
    },
  }));

  try {
    await webhooksDeliverQueue.addBulk(jobs);
    logger.info(
      { orgId: auth.orgId, count: jobs.length },
      "Bulk DLQ replay jobs queued successfully"
    );
  } catch (err) {
    logger.error({ err, orgId: auth.orgId }, "Failed to queue bulk DLQ replay jobs");
    return NextResponse.json(
      { error: "Failed to queue background replay jobs" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: `Re-enqueued ${deliveries.length} deliveries`,
    replayed_count: deliveries.length,
    delivery_ids: deliveries.map((d) => d.id),
  });
}
