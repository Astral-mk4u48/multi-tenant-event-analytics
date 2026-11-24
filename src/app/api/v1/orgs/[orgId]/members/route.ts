import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { resolveAuth } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { canInviteRole, hasPermission } from "@/server/auth/rbac";

export const dynamic = "force-dynamic";

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["OWNER", "ADMIN", "VIEWER"]),
  name: z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const auth = await resolveAuth(req);

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ensure user has access to target orgId
  if (auth.orgId !== orgId) {
    const memberCheck = await migrationPool.query(
      `SELECT role FROM org_memberships WHERE user_id = $1 AND org_id = $2 LIMIT 1`,
      [auth.userId, orgId]
    );
    if (memberCheck.rows.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const query = `
    SELECT u.id AS user_id, u.email, u.name, m.role, m.joined_at, m.last_active_at
    FROM org_memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.org_id = $1
    ORDER BY m.joined_at ASC;
  `;

  try {
    const res = await migrationPool.query(query, [orgId]);
    const members = res.rows.map((m) => ({
      id: `${orgId}_${m.user_id}`,
      user_id: m.user_id,
      userId: m.user_id,
      email: m.email,
      name: m.name,
      role: m.role,
      joined_at: new Date(m.joined_at).toISOString(),
      last_active_at: m.last_active_at ? new Date(m.last_active_at).toISOString() : null,
    }));

    return NextResponse.json({ data: members, members, items: members });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch members";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const auth = await resolveAuth(req);

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.role === "VIEWER" || !hasPermission(auth.role, "manage_team")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = addMemberSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid membership data" }, { status: 400 });
    }

    const { email, role } = parsed.data;
    const name = parsed.data.name || email.split("@")[0];

    if (!canInviteRole(auth.role, role)) {
      return NextResponse.json({ error: "Forbidden: Cannot invite higher or equal role" }, { status: 403 });
    }

    const client = await migrationPool.connect();
    try {
      await client.query("BEGIN");
      let userRes = await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email]);
      let userId: string;
      if (userRes.rows.length === 0) {
        userId = crypto.randomUUID();
        await client.query(
          `INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, NOW())`,
          [userId, email, name]
        );
      } else {
        userId = userRes.rows[0].id;
      }

      await client.query(
        `INSERT INTO org_memberships (org_id, user_id, role, joined_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [orgId, userId, role]
      );
      await client.query("COMMIT");

      return NextResponse.json(
        {
          success: true,
          member: {
            id: `${orgId}_${userId}`,
            userId,
            email,
            name,
            role,
            created_at: new Date().toISOString(),
          },
        },
        { status: 201 }
      );
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to add member";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
