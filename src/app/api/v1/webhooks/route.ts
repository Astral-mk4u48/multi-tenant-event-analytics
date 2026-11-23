import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { resolveAuth, checkCapability } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { encryptSecret, toBase62 } from "@/server/crypto";
import { redis } from "@/server/redis";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

const createEndpointSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  subscribed_events: z.array(z.string()).min(1, "At least one subscribed event required"),
});

/**
 * GET /api/v1/webhooks
 * List registered endpoints with 24h success rate and volume stats (signing secret masked).
 */
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = `
    SELECT
      ep.id,
      ep.url,
      ep.subscribed_events,
      ep.is_active,
      ep.created_at,
      COUNT(d.id)::int AS deliveries_24h,
      COUNT(d.id) FILTER (WHERE d.state = 'DELIVERED')::int AS successful_24h
    FROM webhook_endpoints ep
    LEFT JOIN webhook_deliveries d
      ON d.endpoint_id = ep.id
      AND d.created_at >= NOW() - INTERVAL '24 hours'
    WHERE ep.org_id = $1
    GROUP BY ep.id, ep.url, ep.subscribed_events, ep.is_active, ep.created_at
    ORDER BY ep.created_at DESC;
  `;

  try {
    const res = await migrationPool.query(query, [auth.orgId]);
    const endpoints = res.rows.map((ep) => {
      const total = ep.deliveries_24h;
      const success = ep.successful_24h;
      const rate = total > 0 ? Math.round((success / total) * 1000) / 10 : 100.0;

      return {
        id: ep.id,
        url: ep.url,
        subscribed_events: ep.subscribed_events,
        is_active: ep.is_active,
        signing_secret_masked: "whsec_••••••••••••",
        deliveries_24h: total,
        success_rate_24h: rate,
        created_at: ep.created_at.toISOString(),
      };
    });

    return NextResponse.json({ endpoints });
  } catch (err) {
    logger.error({ err, orgId: auth.orgId }, "Failed to fetch webhook endpoints");
    return NextResponse.json({ error: "Failed to fetch webhooks" }, { status: 500 });
  }
}

/**
 * POST /api/v1/webhooks
 * Registers a new webhook endpoint. Requires ADMIN or OWNER.
 * Generates whsec_ signing secret and returns it once in the response.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkCapability(auth, "manage_webhooks")) {
    return NextResponse.json(
      { error: "Forbidden: Requires ADMIN or OWNER role" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createEndpointSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.format() },
      { status: 422 }
    );
  }

  const { url, subscribed_events } = parsed.data;

  // Generate 32-byte secret with base62 encoding: whsec_...
  const secretPart = toBase62(crypto.randomBytes(32));
  const rawSigningSecret = `whsec_${secretPart}`;
  const encryptedSecret = encryptSecret(rawSigningSecret);
  const endpointId = `ep_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;

  const insertSql = `
    INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret, is_active, created_at)
    VALUES ($1, $2, $3, $4, $5, true, NOW())
    RETURNING id, url, subscribed_events, is_active, created_at;
  `;

  try {
    const res = await migrationPool.query(insertSql, [
      endpointId,
      auth.orgId,
      url,
      subscribed_events,
      encryptedSecret,
    ]);

    // Invalidate Redis active endpoints cache
    await redis.del(`endpoints:active:{${auth.orgId}}`).catch(() => {});

    const created = res.rows[0];
    return NextResponse.json(
      {
        endpoint: {
          id: created.id,
          url: created.url,
          subscribed_events: created.subscribed_events,
          is_active: created.is_active,
          signing_secret: rawSigningSecret, // Plaintext returned ONCE
          created_at: created.created_at.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error({ err, orgId: auth.orgId }, "Failed to create webhook endpoint");
    return NextResponse.json({ error: "Failed to create endpoint" }, { status: 500 });
  }
}
