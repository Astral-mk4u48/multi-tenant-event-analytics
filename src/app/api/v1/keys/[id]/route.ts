import { NextRequest, NextResponse } from "next/server";
import { resolveAuth, checkCapability } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { invalidateApiKeyCache } from "@/server/crypto";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/v1/keys/:id
 * Revokes an API key and immediately purges it from Redis cache.
 * Requires ADMIN or OWNER.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkCapability(auth, "manage_keys")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (auth.isDemo) {
    return NextResponse.json(
      { error: "Demo workspace is read-only. Revoking API keys is disabled." },
      { status: 403 }
    );
  }

  const { id: keyId } = await params;

  try {
    const res = await migrationPool.query(
      `UPDATE api_keys
       SET revoked_at = NOW()
       WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL
       RETURNING id, key_hash`,
      [keyId, auth.orgId]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
    }

    const { key_hash } = res.rows[0];

    // Immediately purge from Redis cache
    await invalidateApiKeyCache(key_hash);

    logger.info({ keyId, orgId: auth.orgId }, "API key revoked and purged from cache");

    return NextResponse.json({ revoked: true, id: keyId });
  } catch (err) {
    logger.error({ err, keyId, orgId: auth.orgId }, "Failed to revoke API key");
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });
  }
}
