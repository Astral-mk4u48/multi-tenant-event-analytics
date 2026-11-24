import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuth, checkCapability } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { generateApiKey } from "@/server/crypto";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const createKeySchema = z.object({
  name: z.string().min(1, "Key name cannot be empty").max(64),
  scope: z.enum(["INGEST", "ADMIN", "ingest", "admin"]).transform((s) => s.toUpperCase() as "INGEST" | "ADMIN"),
  environment: z.enum(["production", "test", "live"]).optional(),
  env: z.enum(["production", "test", "live"]).optional(),
  expires_in_days: z.number().int().positive().optional(),
});

/**
 * GET /api/v1/keys
 * Lists API keys for the current tenant.
 */
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = `
    SELECT
      id,
      name,
      prefix,
      scope,
      last_used_at,
      revoked_at,
      expires_at,
      created_at
    FROM api_keys
    WHERE org_id = $1
      AND (revoked_at IS NULL OR revoked_at >= NOW() - INTERVAL '7 days')
    ORDER BY created_at DESC;
  `;

  try {
    const res = await migrationPool.query(query, [auth.orgId]);
    const keys = res.rows.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scope: k.scope,
      env: "live" as const,
      last_used_at: k.last_used_at ? new Date(k.last_used_at).toISOString() : null,
      revoked_at: k.revoked_at ? new Date(k.revoked_at).toISOString() : null,
      expires_at: k.expires_at ? new Date(k.expires_at).toISOString() : null,
      created_at: new Date(k.created_at).toISOString(),
    }));

    return NextResponse.json({
      data: keys,
      keys,
      items: keys,
    });
  } catch (err) {
    logger.error({ err, orgId: auth.orgId }, "Failed to fetch API keys");
    return NextResponse.json({ error: "Failed to fetch API keys" }, { status: 500 });
  }
}

/**
 * POST /api/v1/keys
 * Generates cryptographically secure API key pair and returns raw secret strictly ONCE.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.role === "VIEWER" || !checkCapability(auth, "manage_keys")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.format() }, { status: 422 });
  }

  const { name, scope, expires_in_days } = parsed.data;
  const generated = generateApiKey(scope);
  const expiresAt = expires_in_days
    ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
    : null;

  const insertSql = `
    INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scope, expires_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    RETURNING id, name, prefix, scope, expires_at, created_at;
  `;

  try {
    const res = await migrationPool.query(insertSql, [
      generated.id,
      auth.orgId,
      name,
      generated.prefix,
      generated.keyHash,
      scope,
      expiresAt,
    ]);

    const row = res.rows[0];
    logger.info({ keyId: row.id, orgId: auth.orgId, scope }, "Issued new scoped API key");

    const keyPayload = {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scope: row.scope,
      rawKey: generated.rawKey,
      raw_key: generated.rawKey,
      plaintext_key: generated.rawKey,
      expires_at: row.expires_at ? row.expires_at.toISOString() : null,
      created_at: row.created_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    };

    return NextResponse.json(
      {
        ...keyPayload,
        key: keyPayload,
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error({ err, orgId: auth.orgId }, "Failed to create API key");
    return NextResponse.json({ error: "Failed to persist API key" }, { status: 500 });
  }
}
