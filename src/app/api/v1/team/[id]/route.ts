import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuth, checkCapability } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const updateRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "VIEWER"]),
});

/**
 * PATCH /api/v1/team/:id
 * Updates member role. Trigger protects against demoting the final OWNER.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkCapability(auth, "manage_team")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: targetUserId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateRoleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid role" }, { status: 422 });
  }

  const { role } = parsed.data;

  try {
    const res = await migrationPool.query(
      `UPDATE org_memberships
       SET role = $1
       WHERE user_id = $2 AND org_id = $3
       RETURNING user_id, org_id, role`,
      [role, targetUserId, auth.orgId]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ updated: true, member: res.rows[0] });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("Cannot demote or delete the final OWNER")) {
      return NextResponse.json(
        { error: "At least one OWNER required for the organization" },
        { status: 400 }
      );
    }
    logger.error({ err, targetUserId, orgId: auth.orgId }, "Failed to update member role");
    return NextResponse.json({ error: "Failed to update member role" }, { status: 500 });
  }
}

/**
 * DELETE /api/v1/team/:id
 * Removes a member from the organization.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkCapability(auth, "manage_team")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: targetUserId } = await params;

  try {
    const res = await migrationPool.query(
      `DELETE FROM org_memberships
       WHERE user_id = $1 AND org_id = $2
       RETURNING user_id`,
      [targetUserId, auth.orgId]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, user_id: targetUserId });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("Cannot demote or delete the final OWNER")) {
      return NextResponse.json(
        { error: "Cannot delete the final OWNER of an organization" },
        { status: 400 }
      );
    }
    logger.error({ err, targetUserId, orgId: auth.orgId }, "Failed to delete member");
    return NextResponse.json({ error: "Failed to delete member" }, { status: 500 });
  }
}
