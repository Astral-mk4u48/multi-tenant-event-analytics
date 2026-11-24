import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { migrationPool } from "@/db";
import { signSession, SESSION_COOKIE_NAME } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleDemoAuth(req);
}

export async function GET(req: NextRequest) {
  return handleDemoAuth(req);
}

async function handleDemoAuth(req: NextRequest) {
  try {
    // 1. Resolve or create acme-prod org
    let orgRes = await migrationPool.query(
      `SELECT id FROM organizations WHERE slug = 'acme-prod' LIMIT 1`
    );
    let orgId: string;
    if (orgRes.rows.length === 0) {
      const insOrg = await migrationPool.query(
        `INSERT INTO organizations (slug, name, rate_limit_rpm)
         VALUES ('acme-prod', 'Acme Corporation', 6000)
         RETURNING id`
      );
      orgId = insOrg.rows[0].id;
    } else {
      orgId = orgRes.rows[0].id;
    }

    // 2. Resolve or create demo user
    let userRes = await migrationPool.query(
      `SELECT id, email, name FROM users WHERE email = 'demo@eventpulse.dev' LIMIT 1`
    );
    let userId: string;
    if (userRes.rows.length === 0) {
      const insUser = await migrationPool.query(
        `INSERT INTO users (id, email, name)
         VALUES ($1, 'demo@eventpulse.dev', 'Demo User')
         RETURNING id, email, name`,
        [crypto.randomUUID()]
      );
      userId = insUser.rows[0].id;
    } else {
      userId = userRes.rows[0].id;
    }

    // 3. Ensure membership in acme-prod
    await migrationPool.query(
      `INSERT INTO org_memberships (user_id, org_id, role, last_active_at)
       VALUES ($1, $2, 'OWNER', NOW())
       ON CONFLICT (org_id, user_id) DO UPDATE SET last_active_at = NOW()`,
      [userId, orgId]
    );

    // 4. Issue signed session cookie
    const token = signSession({
      userId,
      orgId,
      role: "OWNER",
      email: "demo@eventpulse.dev",
      name: "Demo User",
    });

    const isGet = req.method === "GET";
    const res = isGet
      ? NextResponse.redirect(new URL("/dashboard", req.url))
      : NextResponse.json({ success: true, redirect: "/dashboard" });

    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    res.cookies.set({
      name: "active_org_id",
      value: orgId,
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal authentication error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
