import { NextRequest, NextResponse } from "next/server";
import { resolveAuth, checkCapability } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { decryptSecret } from "@/server/crypto";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/:id/secret
 * Decrypts and returns the endpoint signing secret for 10-second UI reveal.
 * Strictly restricted to ADMIN and OWNER roles.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkCapability(auth, "reveal_secrets")) {
    return NextResponse.json(
      { error: "Forbidden: Secret reveal requires ADMIN or OWNER role" },
      { status: 403 }
    );
  }

  const { id: endpointId } = await params;

  try {
    const res = await migrationPool.query(
      "SELECT signing_secret FROM webhook_endpoints WHERE id = $1 AND org_id = $2",
      [endpointId, auth.orgId]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
    }

    const encrypted = res.rows[0].signing_secret;
    let plaintext = encrypted;

    if (encrypted.includes(":") && !encrypted.startsWith("whsec_")) {
      plaintext = decryptSecret(encrypted);
    }

    logger.info({ endpointId, orgId: auth.orgId }, "Webhook signing secret revealed");

    return NextResponse.json({
      signing_secret: plaintext,
      reveal_duration_seconds: 10,
    });
  } catch (err) {
    logger.error({ err, endpointId, orgId: auth.orgId }, "Failed to reveal signing secret");
    return NextResponse.json({ error: "Failed to reveal secret" }, { status: 500 });
  }
}
