import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { migrationPool } from "@/db";
import { verifyApiKey } from "@/server/crypto";
import { verifySession, SESSION_COOKIE_NAME } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/rbac";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const purgeSchema = z.object({
  delivery_ids: z.array(z.string()).optional(),
});

/**
 * DELETE /api/v1/dlq/purge
 * Permanently deletes selected or all DLQ deliveries and cascades to attempts.
 * Requires OWNER or ADMIN role.
 */
export async function DELETE(req: NextRequest) {
  let orgId: string | null = null;
  let userRole: "OWNER" | "ADMIN" | "VIEWER" = "VIEWER";

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const rawKey = authHeader.slice(7).trim();
    const apiKey = await verifyApiKey(rawKey, "ADMIN");
    if (!apiKey) {
      return NextResponse.json({ error: "Unauthorized: Requires ADMIN API key" }, { status: 401 });
    }
    orgId = apiKey.orgId;
    userRole = "ADMIN";
  } else {
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = cookie ? verifySession(cookie) : null;
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: Authentication required" }, { status: 401 });
    }
    orgId = session.orgId;
    userRole = session.role;
  }

  if (!hasPermission(userRole, "purge_dlq")) {
    return NextResponse.json(
      { error: "Forbidden: VIEWER role cannot purge DLQ" },
      { status: 403 }
    );
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional
  }

  const parsed = purgeSchema.safeParse(body);
  const deliveryIds = parsed.success ? parsed.data.delivery_ids : undefined;

  let purgedCount = 0;

  try {
    if (deliveryIds && deliveryIds.length > 0) {
      const res = await migrationPool.query(
        `DELETE FROM webhook_deliveries
         WHERE id = ANY($1::text[]) AND org_id = $2 AND state = 'DLQ'`,
        [deliveryIds, orgId]
      );
      purgedCount = res.rowCount ?? 0;
    } else {
      // Purge all DLQ deliveries for this org
      const res = await migrationPool.query(
        `DELETE FROM webhook_deliveries
         WHERE org_id = $1 AND state = 'DLQ'`,
        [orgId]
      );
      purgedCount = res.rowCount ?? 0;
    }

    logger.info({ orgId, purgedCount }, `Purged ${purgedCount} DLQ items`);
  } catch (err) {
    logger.error({ err, orgId }, "Failed to purge DLQ entries");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }

  return NextResponse.json(
    {
      purged_count: purgedCount,
      message: `Successfully purged ${purgedCount} DLQ items`,
    },
    { status: 200 }
  );
}
