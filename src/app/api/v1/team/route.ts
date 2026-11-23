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
  name: z.string().min(1).max(64),
  role: z.enum(["OWNER", "ADMIN", "VIEWER"]),
});

/**
 * GET /api/v1/team
 * List team members and their roles for the current organization.
 */
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
      user_id: m.user_id,
      email: m.email,
      name: m.name,
      role: m.role,
      joined_at: m.joined_at.toISOString(),
      last_active_at: m.last_active_at ? m.last_active_at.toISOString() : null,
    }));

    return NextResponse.json({ members });
  } catch (err) {
    logger.error({ err, orgId: auth.orgId }, "Failed to fetch team members");
    return NextResponse.json({ error: "Failed to fetch team members" }, { status: 500 });
  }
}

/**
 * POST /api/v1/team
 * Invites / adds a member to the organization.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkCapability(auth, "manage_team")) {
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

  const { email, name, role } = parsed.data;

  // Check if current user can invite this role (ADMIN cannot invite OWNER)
  if (!canInviteRole(auth.role, role)) {
    return NextResponse.json(
      { error: "Forbidden: ADMINs cannot invite an OWNER" },
      { status: 403 }
    );
  }

  try {
    const client = await migrationPool.connect();
    try {
      await client.query("BEGIN");

      // 1. Find or create user
      let userId: string;
      const userRes = await client.query("SELECT id FROM users WHERE email = $1", [email]);
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
      } else {
        userId = crypto.randomUUID();
        await client.query(
          "INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, NOW())",
          [userId, email, name]
        );
      }

      // 2. Add to org_memberships
      await client.query(
        `INSERT INTO org_memberships (user_id, org_id, role, joined_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [userId, auth.orgId, role]
      );

      await client.query("COMMIT");

      return NextResponse.json(
        {
          member: {
            user_id: userId,
            email,
            name,
            role,
            joined_at: new Date().toISOString(),
          },
        },
        { status: 201 }
      );
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err, email, orgId: auth.orgId }, "Failed to add team member");
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }
}
