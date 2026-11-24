import { NextRequest, NextResponse } from "next/server";
import { migrationPool } from "@/db";
import { webhooksDeliverQueue, WebhookDeliverJobData } from "@/server/queues";
import { resolveAuth } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/rbac";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ deliveryId: string }> }
) {
  const { deliveryId } = await params;
  const auth = await resolveAuth(req);

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(auth.role, "replay_webhooks")) {
    return NextResponse.json(
      { error: "Forbidden: VIEWER role cannot trigger webhook replays" },
      { status: 403 }
    );
  }

  const query = `
    SELECT d.id, d.org_id, d.event_id, d.endpoint_id, d.event_name, d.endpoint_url,
           d.state, d.attempt_count, d.max_attempts,
           e.payload, ep.signing_secret
    FROM webhook_deliveries d
    LEFT JOIN events e ON e.id = d.event_id
    LEFT JOIN webhook_endpoints ep ON ep.id = d.endpoint_id
    WHERE d.id = $1 AND d.org_id = $2
  `;

  const res = await migrationPool.query(query, [deliveryId, auth.orgId]);
  if (res.rows.length === 0) {
    return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
  }

  const delivery = res.rows[0];

  await migrationPool.query(
    `UPDATE webhook_deliveries
     SET state = 'QUEUED', updated_at = NOW()
     WHERE id = $1`,
    [deliveryId]
  );

  const jobData: WebhookDeliverJobData = {
    deliveryId: delivery.id,
    orgId: delivery.org_id,
    endpointId: delivery.endpoint_id,
    endpointUrl: delivery.endpoint_url,
    eventName: delivery.event_name,
    eventId: delivery.event_id,
    payload: delivery.payload ?? {},
    signingSecret: delivery.signing_secret || "whsec_fallback",
    attemptNumber: (delivery.attempt_count || 0) + 1,
    maxAttempts: delivery.max_attempts || 5,
    trigger: "manual",
  };

  try {
    await webhooksDeliverQueue.add("deliver", jobData, {
      jobId: `dlq_replay_${deliveryId}_${Date.now()}`,
    });
    logger.info({ deliveryId, orgId: auth.orgId }, "Manual DLQ replay queued successfully");
  } catch (err) {
    logger.error({ err, deliveryId }, "Failed to enqueue DLQ replay");
    return NextResponse.json({ error: "Failed to enqueue delivery job" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: "Delivery re-enqueued for delivery attempt",
    delivery_id: deliveryId,
  });
}
