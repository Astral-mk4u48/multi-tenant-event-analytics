import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { provisionNewUserAndOrg } from "@/server/db/provisioning";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const query = `
      SELECT o.id, o.name, o.slug, o.rate_limit_rpm, m.role
      FROM org_memberships m
      JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1
      ORDER BY o.name ASC;
    `;

    const res = await migrationPool.query(query, [auth.userId]);
    const orgs = res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      role: row.role,
      rateLimitRpm: row.rate_limit_rpm,
      isCurrent: row.id === auth.orgId,
    }));

    return NextResponse.json({
      data: orgs,
      orgs,
      currentOrgId: auth.orgId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch organizations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth || !auth.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, slug } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Organization name is required" }, { status: 400 });
    }

    const orgSlug = slug || name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");

    // Fetch user details
    const userRes = await migrationPool.query(`SELECT email, name FROM users WHERE id = $1`, [auth.userId]);
    const userEmail = userRes.rows[0]?.email || "user@eventpulse.dev";
    const userName = userRes.rows[0]?.name || "Operator";

    const { org } = await provisionNewUserAndOrg({
      userId: auth.userId,
      email: userEmail,
      fullName: userName,
      orgName: name,
      orgSlug,
    });

    const res = NextResponse.json({ success: true, org }, { status: 201 });
    res.cookies.set({
      name: "active_org_id",
      value: org.id,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create organization";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
