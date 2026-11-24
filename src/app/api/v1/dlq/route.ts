import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/server/auth/guard";
import { migrationPool } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const cursor = searchParams.get("cursor");
  const query = searchParams.get("q");

  const whereClauses: string[] = ["d.org_id = $1", "d.state = 'DLQ'"];
  const params: unknown[] = [auth.orgId];
  let paramIdx = 2;

  if (cursor) {
    whereClauses.push(`d.created_at < $${paramIdx}`);
    params.push(cursor);
    paramIdx++;
  }

  if (query) {
    whereClauses.push(`(d.event_name ILIKE $${paramIdx} OR d.id ILIKE $${paramIdx} OR d.endpoint_url ILIKE $${paramIdx})`);
    params.push(`%${query}%`);
    paramIdx++;
  }

  // Count total DLQ items for tenant
  const countRes = await migrationPool.query(
    `SELECT COUNT(*)::int as count FROM webhook_deliveries d WHERE d.org_id = $1 AND d.state = 'DLQ'`,
    [auth.orgId]
  );
  const totalCount = countRes.rows[0]?.count ?? 0;

  params.push(limit + 1);

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
      d.updated_at,
      da.response_body
    FROM webhook_deliveries d
    LEFT JOIN LATERAL (
      SELECT response_body
      FROM webhook_attempts
      WHERE delivery_id = d.id
      ORDER BY attempt_number DESC
      LIMIT 1
    ) da ON true
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY d.created_at DESC
    LIMIT $${paramIdx}
  `;

  try {
    const res = await migrationPool.query(sql, params);
    const rows = res.rows;
    const hasMore = rows.length > limit;
    const dataRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && dataRows.length > 0
        ? dataRows[dataRows.length - 1].created_at instanceof Date
          ? dataRows[dataRows.length - 1].created_at.toISOString()
          : String(dataRows[dataRows.length - 1].created_at)
        : null;

    const mapped = dataRows.map((d) => ({
      id: d.id,
      event_id: d.event_id,
      endpoint_id: d.endpoint_id,
      event_name: d.event_name ?? "—",
      endpoint_url: d.endpoint_url ?? "—",
      state: d.state ?? "DLQ",
      last_status_code: d.last_status_code ?? null,
      status_code: d.last_status_code ?? null,
      is_timeout: Boolean(d.is_timeout),
      last_latency_ms: d.last_latency_ms ?? null,
      latency_ms: d.last_latency_ms ?? null,
      attempt_count: d.attempt_count ?? 0,
      max_attempts: d.max_attempts ?? 5,
      signature_prefix: d.signature_prefix ?? null,
      last_error: d.last_error ?? null,
      lastError: d.last_error ?? null,
      response_body: d.response_body ?? null,
      responseBody: d.response_body ?? null,
      next_retry_at: d.next_retry_at ? new Date(d.next_retry_at).toISOString() : null,
      nextRetryAt: d.next_retry_at ? new Date(d.next_retry_at).toISOString() : null,
      created_at: d.created_at ? new Date(d.created_at).toISOString() : new Date().toISOString(),
      updated_at: d.updated_at ? new Date(d.updated_at).toISOString() : new Date().toISOString(),
    }));

    return NextResponse.json({
      items: mapped,
      data: mapped,
      nextCursor,
      next_cursor: nextCursor,
      totalCount,
      has_more: hasMore,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message, items: [], totalCount: 0, nextCursor: null }, { status: 500 });
  }
}
