import { NextRequest, NextResponse } from "next/server";
import { resolveAuth, checkCapability } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { redis } from "@/server/redis";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/:id/resume
 * Manually resumes a paused webhook endpoint from a tripped circuit breaker.
 * Resets status to ACTIVE, clears paused reason/timestamp, and resets consecutive failure counter.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkCapability(auth, "manage_webhooks")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: endpointId } = await params;

  const query = `
    UPDATE webhook_endpoints
    SET status = 'ACTIVE',
        is_active = true,
        consecutive_failures = 0,
        paused_at = NULL,
        paused_reason = NULL,
        health_score = 100.0
    WHERE id = $1 AND org_id = $2
    RETURNING id, url, status, health_score, is_active;
  `;

  try {
    const res = await migrationPool.query(query, [endpointId, auth.orgId]);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
    }

    try {
      await redis.del(`endpoints:active:{${auth.orgId}}`);
    } catch {
      // Ignore cache invalidation error
    }

    logger.info({ endpointId, orgId: auth.orgId }, "Webhook endpoint manually resumed from circuit breaker");
    return NextResponse.json({ success: true, endpoint: res.rows[0] });
  } catch (err) {
    logger.error({ err, endpointId }, "Failed to resume webhook endpoint");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
