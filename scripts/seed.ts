import crypto from "crypto";
import { migrationPool } from "../src/db";
import { encryptSecret, generateApiKey } from "../src/server/crypto";
import { logger } from "../src/server/logger";

export async function seed() {
  logger.info("Starting seed process...");

  // 1. Upsert primary acme-prod organization
  const orgSlug = "acme-prod";
  const orgRes = await migrationPool.query(
    `INSERT INTO organizations (slug, name, rate_limit_rpm)
     VALUES ($1, 'Acme Corporation', 6000)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [orgSlug]
  );
  const orgId = orgRes.rows[0].id;
  logger.info({ orgId }, "Seeded organization acme-prod");

  // 2. Upsert secondary tenant globex-corp for multi-tenant isolation testing
  const globexRes = await migrationPool.query(
    `INSERT INTO organizations (slug, name, rate_limit_rpm)
     VALUES ('globex-corp', 'Globex Corporation', 3000)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const globexId = globexRes.rows[0].id;
  logger.info({ globexId }, "Seeded organization globex-corp");

  // 3. Users & Memberships
  const usersData = [
    { email: "pavan.sankiliraj@gmail.com", name: "Pavan", role: "OWNER" },
    { email: "alex.chen@acme.com", name: "Alex Chen", role: "ADMIN" },
    { email: "sarah.connor@acme.com", name: "Sarah Connor", role: "VIEWER" },
  ];

  for (const u of usersData) {
    const userRes = await migrationPool.query(
      `INSERT INTO users (email, name)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [u.email, u.name]
    );
    const userId = userRes.rows[0].id;

    await migrationPool.query(
      `INSERT INTO org_memberships (user_id, org_id, role, last_active_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, last_active_at = NOW()`,
      [userId, orgId, u.role]
    );
  }

  // 4. API Keys
  const ingestKey = generateApiKey("INGEST");
  await migrationPool.query(
    `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scope, last_used_at)
     VALUES ($1, $2, 'ingest-prod-eu', $3, $4, 'INGEST', NOW() - INTERVAL '3 minutes')
     ON CONFLICT (key_hash) DO NOTHING`,
    [ingestKey.id, orgId, ingestKey.prefix, ingestKey.keyHash]
  );

  const adminKey = generateApiKey("ADMIN");
  await migrationPool.query(
    `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scope, last_used_at)
     VALUES ($1, $2, 'ops-admin', $3, $4, 'ADMIN', NOW() - INTERVAL '1 day')
     ON CONFLICT (key_hash) DO NOTHING`,
    [adminKey.id, orgId, adminKey.prefix, adminKey.keyHash]
  );

  logger.info({ ingestPrefix: ingestKey.prefix, adminPrefix: adminKey.prefix }, "Generated sample API keys");

  // 5. Webhook Endpoints
  const ep1Secret = encryptSecret("whsec_9f2c41ab77d0e3a4b6c8d0e2f411aa22");
  const ep1Res = await migrationPool.query(
    `INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret, is_active)
     VALUES ('ep_01J8MN9P2K', $1, 'https://api.northwind.io/hooks/billing', ARRAY['payment.*', 'invoice.*'], $2, true)
     ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url
     RETURNING id`,
    [orgId, ep1Secret]
  );
  const ep1Id = ep1Res.rows[0].id;

  const ep2Secret = encryptSecret("whsec_5d8e12fc44b1a890eef2341209ccbb88");
  await migrationPool.query(
    `INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret, is_active)
     VALUES ('ep_01J8MN9P4L', $1, 'https://hooks.slackrelay.dev/events', ARRAY['user.signup', 'deployment.*'], $2, true)
     ON CONFLICT (id) DO NOTHING`,
    [orgId, ep2Secret]
  );

  const ep3Secret = encryptSecret("whsec_11223344556677889900aabbccddeeff");
  await migrationPool.query(
    `INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret, is_active)
     VALUES ('ep_01J8MN9P6M', $1, 'https://legacy.internal.corp/drain', ARRAY['*'], $2, false)
     ON CONFLICT (id) DO NOTHING`,
    [orgId, ep3Secret]
  );

  // 6. Events & Deliveries across last 24h
  const eventTypes = [
    "payment.succeeded",
    "payment.failed",
    "session.started",
    "user.signup",
    "invoice.paid",
    "subscription.renewed",
    "page.viewed",
  ];

  for (let i = 0; i < 60; i++) {
    const eventName = eventTypes[i % eventTypes.length];
    const evtId = `evt_01J9XK3M${i.toString().padStart(4, "0")}`;
    const minutesAgo = i * 20;
    const isRateLimited = i === 12 || i === 34;
    const latency = Math.round((8.5 + (i % 15) * 1.2) * 10) / 10;

    await migrationPool.query(
      `INSERT INTO events (id, org_id, event_name, payload, ingest_latency_ms, status_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() - ($7 || ' minutes')::interval)
       ON CONFLICT (id) DO NOTHING`,
      [
        evtId,
        orgId,
        eventName,
        JSON.stringify({
          id: evtId,
          type: eventName,
          amount_cents: 4900 + i * 150,
          customer_id: `cus_${(1000 + i).toString()}`,
        }),
        latency,
        isRateLimited ? 429 : 202,
        minutesAgo,
      ]
    );

    // Deliveries
    if (i < 20 && !isRateLimited) {
      const dlvId = `dlv_01J9XK3M7Q8N${i.toString(36)}`;
      const isDLQ = i === 0 || i === 3 || i === 7;
      const isDelivered = !isDLQ && i % 2 === 0;
      const state = isDLQ ? "DLQ" : isDelivered ? "DELIVERED" : "RETRYING";
      const statusCode = isDelivered ? 200 : isDLQ ? 502 : 429;
      const attemptsCount = isDLQ ? 5 : isDelivered ? 1 : 2;

      await migrationPool.query(
        `INSERT INTO webhook_deliveries (
           id, org_id, event_id, endpoint_id, event_name, endpoint_url,
           state, last_status_code, is_timeout, last_latency_ms,
           attempt_count, max_attempts, signature_prefix, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 'https://api.northwind.io/hooks/billing', $6, $7, false, $8, $9, 5, 'sha256=9f2c41ab...', NOW() - ($10 || ' minutes')::interval, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          dlvId,
          orgId,
          evtId,
          ep1Id,
          eventName,
          state,
          statusCode,
          412,
          attemptsCount,
          minutesAgo,
        ]
      );

      // Attempts
      for (let att = 1; att <= attemptsCount; att++) {
        const attStatus = att === attemptsCount && isDelivered ? 200 : isDLQ ? 502 : 429;
        await migrationPool.query(
          `INSERT INTO webhook_attempts (
             id, org_id, delivery_id, attempt_number, trigger,
             status_code, is_timeout, latency_ms,
             request_headers, request_body, response_headers, response_body,
             response_truncated, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, false, 412, $7, $8, $9, $10, false, NOW() - ($11 || ' minutes')::interval)
           ON CONFLICT (id) DO NOTHING`,
          [
            `att_${dlvId}_${att}`,
            orgId,
            dlvId,
            att,
            "auto",
            attStatus,
            JSON.stringify({
              "content-type": "application/json",
              "x-webhook-id": dlvId,
              "x-webhook-timestamp": "1795461242",
            }),
            JSON.stringify({ id: evtId, type: eventName, amount_cents: 4900 }),
            JSON.stringify({ server: "cloudflare", "content-type": "text/plain" }),
            attStatus === 200 ? '{"status":"ok"}' : "502 Bad Gateway",
            minutesAgo - att * 2,
          ]
        );
      }
    }
  }

  logger.info("Database seeding completed successfully");
}

seed()
  .then(() => {
    migrationPool.end();
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "Seed script failed");
    migrationPool.end();
    process.exit(1);
  });
