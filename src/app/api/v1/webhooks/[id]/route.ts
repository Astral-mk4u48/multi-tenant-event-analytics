import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuth, checkCapability } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { redis } from "@/server/redis";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const patchEndpointSchema = z.object({
  url: z.string().url().optional(),
  subscribed_events: z.array(z.string()).min(1).optional(),
  is_active: z.boolean().optional(),
});

/**
 * PATCH /api/v1/webhooks/:id
 * Updates or toggles an existing webhook endpoint. Requires ADMIN or OWNER.
 */
export async function PATCH(
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchEndpointSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.format() }, { status: 422 });
  }

  const updates: string[] = [];
  const values: unknown[] = [endpointId, auth.orgId];
  let valIdx = 3;

  if (parsed.data.url !== undefined) {
    updates.push(`url = $${valIdx}`);
    values.push(parsed.data.url);
    valIdx++;
  }

  if (parsed.data.subscribed_events !== undefined) {
    updates.push(`subscribed_events = $${valIdx}`);
    values.push(parsed.data.subscribed_events);
    valIdx++;
  }

  if (parsed.data.is_active !== undefined) {
    updates.push(`is_active = $${valIdx}`);
    values.push(parsed.data.is_active);
    valIdx++;
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const sql = `
    UPDATE webhook_endpoints
    SET ${updates.join(", ")}
    WHERE id = $1 AND org_id = $2
    RETURNING id, url, subscribed_events, is_active, created_at;
  `;

  try {
    const res = await migrationPool.query(sql, values);
    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
    }

    // Invalidate Redis active endpoints cache
    await redis.del(`endpoints:active:{${auth.orgId}}`).catch(() => {});

    return NextResponse.json({ endpoint: res.rows[0] });
  } catch (err) {
    logger.error({ err, endpointId, orgId: auth.orgId }, "Failed to update webhook endpoint");
    return NextResponse.json({ error: "Failed to update endpoint" }, { status: 500 });
  }
}

/**
 * DELETE /api/v1/webhooks/:id
 */
export async function DELETE(
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

  try {
    const res = await migrationPool.query(
      "DELETE FROM webhook_endpoints WHERE id = $1 AND org_id = $2 RETURNING id",
      [endpointId, auth.orgId]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
    }

    await redis.del(`endpoints:active:{${auth.orgId}}`).catch(() => {});

    return NextResponse.json({ deleted: true, id: endpointId });
  } catch (err) {
    logger.error({ err, endpointId, orgId: auth.orgId }, "Failed to delete webhook endpoint");
    return NextResponse.json({ error: "Failed to delete endpoint" }, { status: 500 });
  }
}
