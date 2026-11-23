import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/deliveries
 * Cursor-paginated (50/page) delivery logs with filters.
 * Filters: state, status_class (2xx, 3xx, 4xx, 5xx), endpoint_id, q
 */
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const cursor = searchParams.get("cursor"); // ISO created_at string
  const state = searchParams.get("state");
  const statusClass = searchParams.get("status_class");
  const endpointId = searchParams.get("endpoint_id");
  const query = searchParams.get("q");

  const whereClauses: string[] = ["d.org_id = $1"];
  const params: unknown[] = [auth.orgId];
  let paramIdx = 2;

  if (cursor) {
    whereClauses.push(`d.created_at < $${paramIdx}`);
    params.push(cursor);
    paramIdx++;
  }

  if (state) {
    whereClauses.push(`d.state = $${paramIdx}`);
    params.push(state.toUpperCase());
    paramIdx++;
  }

  if (endpointId) {
    whereClauses.push(`d.endpoint_id = $${paramIdx}`);
    params.push(endpointId);
    paramIdx++;
  }

  if (statusClass) {
    const sc = statusClass.toLowerCase();
    if (sc === "2xx") {
      whereClauses.push(`d.last_status_code >= 200 AND d.last_status_code < 300`);
    } else if (sc === "3xx") {
      whereClauses.push(`d.last_status_code >= 300 AND d.last_status_code < 400`);
    } else if (sc === "4xx") {
      whereClauses.push(`d.last_status_code >= 400 AND d.last_status_code < 500`);
    } else if (sc === "5xx") {
      whereClauses.push(`d.last_status_code >= 500 AND d.last_status_code < 600`);
    }
  }

  if (query) {
    whereClauses.push(`(d.event_name ILIKE $${paramIdx} OR d.id ILIKE $${paramIdx} OR d.endpoint_url ILIKE $${paramIdx})`);
    params.push(`%${query}%`);
    paramIdx++;
  }

  params.push(limit + 1); // Fetch limit + 1 to check if has_more

  const sql = `
    SELECT
      d.id,
      d.event_id,
      d.endpoint_id,
      d.event_name,
      d.endpoint_url,
      d.state,
      d.last_status_code,
      d.is_timeout,
      d.last_latency_ms,
      d.attempt_count,
      d.max_attempts,
      d.signature_prefix,
      d.next_retry_at,
      d.created_at,
      d.updated_at
    FROM webhook_deliveries d
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY d.created_at DESC
    LIMIT $${paramIdx}
  `;

  try {
    const res = await migrationPool.query(sql, params);
    const rows = res.rows;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].created_at.toISOString() : null;

    return NextResponse.json({
      data: data.map((d) => ({
        id: d.id,
        event_id: d.event_id,
        endpoint_id: d.endpoint_id,
        event_name: d.event_name,
        endpoint_url: d.endpoint_url,
        state: d.state,
        status_code: d.last_status_code,
        is_timeout: d.is_timeout,
        latency_ms: d.last_latency_ms,
        attempt_count: d.attempt_count,
        max_attempts: d.max_attempts,
        signature_prefix: d.signature_prefix,
        next_retry_at: d.next_retry_at ? d.next_retry_at.toISOString() : null,
        created_at: d.created_at.toISOString(),
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (err) {
    logger.error({ err, orgId: auth.orgId }, "Failed to fetch deliveries");
    return NextResponse.json({ error: "Failed to fetch deliveries" }, { status: 500 });
  }
}
