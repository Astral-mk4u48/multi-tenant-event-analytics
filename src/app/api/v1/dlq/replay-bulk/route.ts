import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { migrationPool } from "@/db";
import { webhooksDeliverQueue, WebhookDeliverJobData } from "@/server/queues";
import { verifyApiKey } from "@/server/crypto";
import { verifySession, SESSION_COOKIE_NAME } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/rbac";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const bulkReplaySchema = z.object({
  delivery_ids: z.array(z.string()).min(1).max(100),
});

/**
 * POST /api/v1/dlq/replay-bulk
 * Queues up to 100 DLQ deliveries for manual replay idempotently.
 */
export async function POST(req: NextRequest) {
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

  if (!hasPermission(userRole, "replay_webhooks")) {
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

  const parsed = bulkReplaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload: delivery_ids array required (1-100 items)" },
      { status: 422 }
    );
  }

  const { delivery_ids } = parsed.data;

  // Fetch all requested DLQ deliveries strictly scoped to this organization
  const query = `
    SELECT d.id, d.org_id, d.event_id, d.endpoint_id, d.event_name, d.endpoint_url,
           d.attempt_count, d.max_attempts,
           e.payload, ep.signing_secret
    FROM webhook_deliveries d
    LEFT JOIN events e ON e.id = d.event_id
    LEFT JOIN webhook_endpoints ep ON ep.id = d.endpoint_id
    WHERE d.id = ANY($1::text[]) AND d.org_id = $2
  `;

  const res = await migrationPool.query(query, [delivery_ids, orgId]);
  const deliveries = res.rows;

  if (deliveries.length === 0) {
    return NextResponse.json(
      { message: "No matching deliveries found", replayed_count: 0 },
      { status: 200 }
    );
  }

  // Update deliveries state to QUEUED
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
    logger.info({ orgId, count: jobs.length }, `Bulk replayed ${jobs.length} DLQ webhooks`);
  } catch (err) {
    logger.error({ err, orgId }, "Failed to bulk-enqueue manual DLQ replays");
    return NextResponse.json({ error: "Internal Server Error: Queue unavailable" }, { status: 500 });
  }

  return NextResponse.json(
    {
      queued: true,
      replayed_count: jobs.length,
    },
    { status: 202 }
  );
}
