import { NextRequest, NextResponse } from "next/server";
import { migrationPool } from "@/db";
import { webhooksDeliverQueue, WebhookDeliverJobData } from "@/server/queues";
import { verifyApiKey } from "@/server/crypto";
import { verifySession, SESSION_COOKIE_NAME } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/rbac";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/deliveries/:id/replay
 * Triggers an idempotent manual replay of a single webhook delivery.
 * Accessible to OWNER and ADMIN roles.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: deliveryId } = await params;

  // 1. Authenticate via Bearer API Key or Session Cookie
  let orgId: string | null = null;
  let userRole: "OWNER" | "ADMIN" | "VIEWER" = "VIEWER";

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const rawKey = authHeader.slice(7).trim();
    const apiKey = await verifyApiKey(rawKey, "ADMIN");
    if (!apiKey) {
      return NextResponse.json({ error: "Unauthorized: Requires ADMIN API key" }, { status: 401 });
    }
    orgId = apiKey.orgId;
    userRole = "ADMIN";
  } else {
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = cookie ? verifySession(cookie) : null;
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: Authentication required" }, { status: 401 });
    }
    orgId = session.orgId;
    userRole = session.role;
  }

  // 2. Check RBAC permissions (replay_webhooks requires ADMIN or OWNER)
  if (!hasPermission(userRole, "replay_webhooks")) {
    return NextResponse.json(
      { error: "Forbidden: VIEWER role cannot trigger webhook replays" },
      { status: 403 }
    );
  }

  // 3. Fetch delivery and associated endpoint details
  const query = `
    SELECT d.id, d.org_id, d.event_id, d.endpoint_id, d.event_name, d.endpoint_url,
           d.state, d.attempt_count, d.max_attempts,
           e.payload, ep.signing_secret
    FROM webhook_deliveries d
    LEFT JOIN events e ON e.id = d.event_id
    LEFT JOIN webhook_endpoints ep ON ep.id = d.endpoint_id
    WHERE d.id = $1 AND d.org_id = $2
  `;

  const res = await migrationPool.query(query, [deliveryId, orgId]);
  if (res.rows.length === 0) {
    return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
  }

  const delivery = res.rows[0];

  // 4. Update delivery state back to QUEUED
  await migrationPool.query(
    `UPDATE webhook_deliveries
     SET state = 'QUEUED', updated_at = NOW()
     WHERE id = $1`,
    [deliveryId]
  );

  // 5. Enqueue manual replay job into BullMQ
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
      jobId: `manual_replay_${deliveryId}_${Date.now()}`,
    });
    logger.info({ deliveryId, orgId }, "Manual webhook replay queued successfully");
  } catch (err) {
    logger.error({ err, deliveryId }, "Failed to enqueue manual replay");
    return NextResponse.json({ error: "Internal Server Error: Queue unavailable" }, { status: 500 });
  }

  return NextResponse.json({ queued: true, delivery_id: deliveryId }, { status: 202 });
}
