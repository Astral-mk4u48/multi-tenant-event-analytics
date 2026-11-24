import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { migrationPool } from "@/db";
import { signSession, SESSION_COOKIE_NAME } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid credentials" },
        { status: 400 }
      );
    }

    const { email } = parsed.data;

    // Lookup user in database
    const userRes = await migrationPool.query(
      `SELECT u.id, u.email, u.name, m.org_id, m.role, o.slug as org_slug, o.name as org_name
       FROM users u
       INNER JOIN org_memberships m ON m.user_id = u.id
       INNER JOIN organizations o ON o.id = m.org_id
       WHERE LOWER(u.email) = LOWER($1)
       LIMIT 1`,
      [email]
    );

    if (userRes.rows.length === 0) {
      return NextResponse.json(
        { error: "Invalid email or user not found. Please sign up to create a workspace." },
        { status: 401 }
      );
    }

    const row = userRes.rows[0];

    const token = signSession({
      userId: row.id,
      orgId: row.org_id,
      role: row.role,
      email: row.email,
      name: row.name,
    });

    const res = NextResponse.json({
      success: true,
      redirect: "/dashboard",
      user: { id: row.id, email: row.email, name: row.name },
      org: { id: row.org_id, name: row.org_name, slug: row.org_slug },
    });

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
      value: row.org_id,
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
