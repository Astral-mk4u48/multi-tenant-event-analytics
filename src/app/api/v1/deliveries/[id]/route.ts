import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/deliveries/:id
 * Full Payload Inspector data contract per Section 5.2 of the specification.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: deliveryId } = await params;

  try {
    // 1. Fetch delivery with endpoint active status
    const dlvQuery = `
      SELECT
        d.id,
        d.event_id,
        d.event_name,
        d.endpoint_id,
        d.endpoint_url,
        COALESCE(ep.is_active, true) AS endpoint_active,
        d.state,
        d.last_status_code,
        d.is_timeout,
        d.last_latency_ms,
        d.attempt_count,
        d.max_attempts,
        d.signature_prefix,
        d.created_at
      FROM webhook_deliveries d
      LEFT JOIN webhook_endpoints ep ON ep.id = d.endpoint_id
      WHERE d.id = $1 AND d.org_id = $2
    `;
    const dlvRes = await migrationPool.query(dlvQuery, [deliveryId, auth.orgId]);
    if (dlvRes.rows.length === 0) {
      return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
    }

    const dlv = dlvRes.rows[0];

    // 2. Fetch attempts in descending order
    const attQuery = `
      SELECT
        id,
        attempt_number,
        trigger,
        status_code,
        is_timeout,
        latency_ms,
        request_headers,
        request_body,
        response_headers,
        response_body,
        response_truncated,
        next_retry_delay_ms,
        created_at
      FROM webhook_attempts
      WHERE delivery_id = $1 AND org_id = $2
      ORDER BY attempt_number DESC
    `;
    const attRes = await migrationPool.query(attQuery, [deliveryId, auth.orgId]);
    const attempts = attRes.rows;

    const latest = attempts[0] || null;

    return NextResponse.json({
      id: dlv.id,
      event_id: dlv.event_id,
      event_name: dlv.event_name,
      endpoint_id: dlv.endpoint_id,
      endpoint_url: dlv.endpoint_url,
      endpoint_active: dlv.endpoint_active,
      state: dlv.state,
      status_code: dlv.last_status_code,
      is_timeout: dlv.is_timeout,
      latency_ms: dlv.last_latency_ms,
      attempt_count: dlv.attempt_count,
      max_attempts: dlv.max_attempts,
      timestamp_utc: dlv.created_at.toISOString(),
      signature_prefix: dlv.signature_prefix,
      latest_attempt: latest
        ? {
            request_headers: latest.request_headers,
            request_body: latest.request_body,
            response_headers: latest.response_headers || {},
            response_body: latest.response_body || "",
            response_truncated: latest.response_truncated,
          }
        : null,
      attempts: attempts.map((a) => ({
        attempt_number: a.attempt_number,
        timestamp_utc: a.created_at.toISOString(),
        status_code: a.status_code,
        is_timeout: a.is_timeout,
        latency_ms: a.latency_ms,
        next_retry_delay_ms: a.next_retry_delay_ms,
        trigger: a.trigger,
      })),
    });
  } catch (err) {
    logger.error({ err, deliveryId, orgId: auth.orgId }, "Failed to fetch delivery details");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
