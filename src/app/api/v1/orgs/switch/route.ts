import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/server/auth/guard";
import { migrationPool } from "@/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth || !auth.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const targetOrgId = body.orgId || body.org_id;

    if (!targetOrgId || typeof targetOrgId !== "string") {
      return NextResponse.json({ error: "Valid orgId is required" }, { status: 400 });
    }

    // Verify user belongs to the requested organization
    const memberRes = await migrationPool.query(
      `SELECT org_id, role FROM org_memberships WHERE user_id = $1 AND org_id = $2 LIMIT 1`,
      [auth.userId, targetOrgId]
    );

    if (memberRes.rows.length === 0) {
      return NextResponse.json(
        { error: "Forbidden: You are not a member of this organization" },
        { status: 403 }
      );
    }

    const res = NextResponse.json({
      success: true,
      active_org_id: targetOrgId,
      role: memberRes.rows[0].role,
    });

    res.cookies.set({
      name: "active_org_id",
      value: targetOrgId,
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to switch organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
