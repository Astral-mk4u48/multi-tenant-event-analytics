import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { resolveAuth, checkCapability } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { canInviteRole } from "@/server/auth/rbac";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const inviteMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(64).optional(),
  role: z.enum(["OWNER", "ADMIN", "VIEWER"]),
});

export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = `
    SELECT
      u.id AS user_id,
      u.email,
      u.name,
      m.role,
      m.joined_at,
      m.last_active_at
    FROM org_memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.org_id = $1
    ORDER BY m.joined_at ASC;
  `;

  try {
    const res = await migrationPool.query(query, [auth.orgId]);
    const members = res.rows.map((m) => ({
      id: `${auth.orgId}_${m.user_id}`,
      user_id: m.user_id,
      userId: m.user_id,
      email: m.email,
      name: m.name,
      role: m.role,
      joined_at: new Date(m.joined_at).toISOString(),
      created_at: new Date(m.joined_at).toISOString(),
      last_active_at: m.last_active_at ? new Date(m.last_active_at).toISOString() : null,
    }));

    return NextResponse.json({
      data: members,
      members,
      items: members,
    });
  } catch (err) {
    logger.error({ err, orgId: auth.orgId }, "Failed to fetch team members");
    return NextResponse.json({ error: "Failed to fetch team members" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.role === "VIEWER" || !checkCapability(auth, "manage_team")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = inviteMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.format() }, { status: 422 });
  }

  const { email, role } = parsed.data;
  const name = parsed.data.name || email.split("@")[0];

  if (!canInviteRole(auth.role, role)) {
    return NextResponse.json(
      { error: "Forbidden: Cannot invite a role higher or equal to OWNER" },
      { status: 403 }
    );
  }

  try {
    const client = await migrationPool.connect();
    try {
      await client.query("BEGIN");

      let userRes = await client.query(
        `SELECT id, email, name FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );

      let userId: string;
      if (userRes.rows.length === 0) {
        userId = crypto.randomUUID();
        await client.query(
          `INSERT INTO users (id, email, name, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [userId, email, name]
        );
      } else {
        userId = userRes.rows[0].id;
      }

      await client.query(
        `INSERT INTO org_memberships (org_id, user_id, role, joined_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [auth.orgId, userId, role]
      );

      await client.query("COMMIT");

      return NextResponse.json(
        {
          success: true,
          member: {
            id: `${auth.orgId}_${userId}`,
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
    const message = err instanceof Error ? err.message : "Failed to invite member";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
