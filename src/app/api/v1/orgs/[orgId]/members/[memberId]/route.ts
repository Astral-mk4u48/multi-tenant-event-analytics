import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuth } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { hasPermission } from "@/server/auth/rbac";

export const dynamic = "force-dynamic";

const patchMemberSchema = z.object({
  role: z.enum(["ADMIN", "VIEWER"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; memberId: string }> }
) {
  const { orgId, memberId } = await params;
  const auth = await resolveAuth(req);

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.role !== "OWNER") {
    return NextResponse.json({ error: "Forbidden: Only OWNER can modify member roles" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = patchMemberSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid role: must be ADMIN or VIEWER" }, { status: 400 });
    }

    const userId = memberId.includes("_") ? memberId.split("_")[1] : memberId;

    const res = await migrationPool.query(
      `UPDATE org_memberships
       SET role = $1
       WHERE org_id = $2 AND user_id = $3
       RETURNING org_id, user_id, role`,
      [parsed.data.role, orgId, userId]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, member: res.rows[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update member role";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; memberId: string }> }
) {
  const { orgId, memberId } = await params;
  const auth = await resolveAuth(req);

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.role !== "OWNER" && auth.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden: Requires OWNER or ADMIN" }, { status: 403 });
  }

  const userId = memberId.includes("_") ? memberId.split("_")[1] : memberId;

  // Cannot delete yourself if you are the OWNER
  if (userId === auth.userId && auth.role === "OWNER") {
    return NextResponse.json({ error: "Cannot remove organization OWNER" }, { status: 400 });
  }

  try {
    const res = await migrationPool.query(
      `DELETE FROM org_memberships
       WHERE org_id = $1 AND user_id = $2
       RETURNING org_id, user_id`,
      [orgId, userId]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, removed: true, userId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to revoke member";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
