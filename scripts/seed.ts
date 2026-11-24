import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import { migrationPool } from "../src/db";
import { encryptSecret, generateApiKey } from "../src/server/crypto";
import { logger } from "../src/server/logger";

/**
 * Deterministic 32-bit PRNG (Mulberry32) for reproducible, realistic demo data.
 */
function createPrng(seedVal: number) {
  let s = seedVal >>> 0;
  return function () {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weighted event type distribution:
 * page.viewed (35%), session.started (25%), payment.succeeded (15%),
 * user.signup (10%), invoice.paid (8%), payment.failed (4%), subscription.renewed (3%).
 */
function pickWeightedEventType(r: number): string {
  if (r < 0.35) return "page.viewed";
  if (r < 0.6) return "session.started";
  if (r < 0.75) return "payment.succeeded";
  if (r < 0.85) return "user.signup";
  if (r < 0.93) return "invoice.paid";
  if (r < 0.97) return "payment.failed";
  return "subscription.renewed";
}

/**
 * Generates right-skewed latencies with median ~5.8ms and p99 ~12ms.
 */
function sampleIngestLatency(r: number): number {
  return Math.round((4.5 + Math.pow(r, 2.6) * 8.2) * 10) / 10;
}

export async function seed() {
  logger.info("Starting production demo seeding process...");
  const prng = createPrng(0x89abcdef);

  // 1. Primary demo tenant: acme-prod
  const orgRes = await migrationPool.query(
    `INSERT INTO organizations (slug, name, rate_limit_rpm)
     VALUES ('acme-prod', 'Acme Corporation', 6000)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const orgId = orgRes.rows[0].id;
  logger.info({ orgId }, "Seeded organization acme-prod");

  // 2. Secondary tenant for multi-tenant isolation verification
  const globexRes = await migrationPool.query(
    `INSERT INTO organizations (slug, name, rate_limit_rpm)
     VALUES ('globex-corp', 'Globex Corporation', 3000)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const globexId = globexRes.rows[0].id;
  logger.info({ globexId }, "Seeded organization globex-corp");

  // 3. Clean up old deliveries and events
  await migrationPool.query(`DELETE FROM webhook_attempts WHERE org_id = $1`, [orgId]);
  await migrationPool.query(`DELETE FROM webhook_deliveries WHERE org_id = $1`, [orgId]);
  await migrationPool.query(`DELETE FROM events WHERE org_id = $1`, [orgId]);
  await migrationPool.query(`DELETE FROM api_keys WHERE org_id = $1`, [orgId]);
  await migrationPool.query(`DELETE FROM webhook_endpoints WHERE org_id = $1`, [orgId]);

  // 4. Users: Exactly one OWNER (demo@eventpulse.dev) + realistic non-meme team members
  // Ensure demo user is OWNER first to satisfy the prevent_last_owner_removal trigger
  const demoUserRes = await migrationPool.query(
    `INSERT INTO users (email, name)
     VALUES ('demo@eventpulse.dev', 'Demo User')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const demoUserId = demoUserRes.rows[0].id;

  await migrationPool.query(
    `INSERT INTO org_memberships (user_id, org_id, role, last_active_at)
     VALUES ($1, $2, 'OWNER', NOW() - INTERVAL '15 minutes')
     ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'OWNER', last_active_at = EXCLUDED.last_active_at`,
    [demoUserId, orgId]
  );

  // Now safely remove all other memberships from this org
  await migrationPool.query(
    `DELETE FROM org_memberships WHERE org_id = $1 AND user_id != $2`,
    [orgId, demoUserId]
  );

  // Purge any personal or old placeholder users
  await migrationPool.query(
    `DELETE FROM users WHERE email = 'pavan.sankiliraj@gmail.com' OR email LIKE '%@acme.com'`
  );

  // Add realistic team members
  const teamUsers = [
    { email: "marcus.vance@northerntrust.dev", name: "Marcus Vance", role: "ADMIN" as const },
    { email: "elena.rostova@northerntrust.dev", name: "Elena Rostova", role: "VIEWER" as const },
  ];

  for (const u of teamUsers) {
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
       VALUES ($1, $2, $3, NOW() - INTERVAL '4 hours')
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role, last_active_at = EXCLUDED.last_active_at`,
      [userId, orgId, u.role]
    );
  }

  // 5. Scoped API Keys (ensuring last_used >= created and no junk keys)
  const ingestKey = generateApiKey("INGEST");
  await migrationPool.query(
    `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scope, created_at, last_used_at)
     VALUES ($1, $2, 'ingest-prod-eu', $3, $4, 'INGEST', NOW() - INTERVAL '60 days', NOW() - INTERVAL '3 minutes')
     ON CONFLICT (key_hash) DO NOTHING`,
    [ingestKey.id, orgId, ingestKey.prefix, ingestKey.keyHash]
  );

  const adminKey = generateApiKey("ADMIN");
  await migrationPool.query(
    `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scope, created_at, last_used_at)
     VALUES ($1, $2, 'ops-admin', $3, $4, 'ADMIN', NOW() - INTERVAL '30 days', NOW() - INTERVAL '1 day')
     ON CONFLICT (key_hash) DO NOTHING`,
    [adminKey.id, orgId, adminKey.prefix, adminKey.keyHash]
  );

  // 6. Registered Webhook Endpoints
  const ep1Secret = encryptSecret("whsec_9f2c41ab77d0e3a4b6c8d0e2f411aa22");
  const ep1Res = await migrationPool.query(
    `INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret, status, health_score, consecutive_failures, is_active)
     VALUES ('ep_01J8MN9P2K', $1, 'https://api.northwind.io/hooks/billing', ARRAY['payment.*', 'invoice.*'], $2, 'ACTIVE', 0.98, 0, true)
     ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, health_score = 0.98, consecutive_failures = 0, status = 'ACTIVE'
     RETURNING id`,
    [orgId, ep1Secret]
  );
  const ep1Id = ep1Res.rows[0].id;

  const ep2Secret = encryptSecret("whsec_5d8e12fc44b1a890eef2341209ccbb88");
  const ep2Res = await migrationPool.query(
    `INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret, status, health_score, consecutive_failures, is_active)
     VALUES ('ep_01J8MN9P4L', $1, 'https://hooks.slackrelay.dev/events', ARRAY['user.signup', 'subscription.*'], $2, 'ACTIVE', 1.0, 0, true)
     ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, health_score = 1.0, consecutive_failures = 0, status = 'ACTIVE'
     RETURNING id`,
    [orgId, ep2Secret]
  );
  const ep2Id = ep2Res.rows[0].id;

  const ep3Secret = encryptSecret("whsec_11223344556677889900aabbccddeeff");
  await migrationPool.query(
    `INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret, status, health_score, consecutive_failures, is_active)
     VALUES ('ep_01J8MN9P6M', $1, 'https://legacy.internal.corp/drain', ARRAY['*'], $2, 'DISABLED', 0.0, 0, false)
     ON CONFLICT (id) DO UPDATE SET status = 'DISABLED', is_active = false`,
    [orgId, ep3Secret]
  );

  // 7. Seed 200 events across the last 24 hours with weighted distribution and skewed latencies
  const totalEvents = 200;
  const eventIds: { id: string; name: string; minutesAgo: number; isRateLimited: boolean }[] = [];

  for (let i = 0; i < totalEvents; i++) {
    const eventName = pickWeightedEventType(prng());
    const evtId = `evt_01J9XK${i.toString().padStart(6, "0")}`;
    // Spread evenly across the last 23.8 hours down to 2 minutes ago
    const minutesAgo = Math.round(((totalEvents - 1 - i) / totalEvents) * 1420 + 2);
    // Rate limit ~2.5% of events (5 events out of 200)
    const isRateLimited = i === 18 || i === 54 || i === 112 || i === 148 || i === 182;
    const latency = sampleIngestLatency(prng());

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
          amount_cents: Math.round(1500 + prng() * 12500),
          customer_id: `cus_${Math.round(1000 + prng() * 9000)}`,
        }),
        latency,
        isRateLimited ? 429 : 202,
        minutesAgo,
      ]
    );

    eventIds.push({ id: evtId, name: eventName, minutesAgo, isRateLimited });
  }

  // 8. Seed Webhook Deliveries: 97 DELIVERED + 3 DLQ = 100 Deliveries (97% success rate)
  // Filter candidate events matching active webhook patterns
  const candidateEvents = eventIds.filter((e) => !e.isRateLimited);
  let deliveryIdx = 0;

  // Designate 3 specific failures in DLQ across both endpoints with realistic failure modes
  const dlqPlans = [
    {
      endpointId: ep1Id,
      endpointUrl: "https://api.northwind.io/hooks/billing",
      eventName: "payment.failed",
      minutesAgo: 45,
      statusCode: 502,
      isTimeout: false,
      latency: 412,
      lastError: "HTTP 502 Bad Gateway",
      respBody: "502 Bad Gateway: Upstream billing gateway connection refused",
    },
    {
      endpointId: ep2Id,
      endpointUrl: "https://hooks.slackrelay.dev/events",
      eventName: "user.signup",
      minutesAgo: 110,
      statusCode: null,
      isTimeout: true,
      latency: 5000,
      lastError: "Connection timed out after 5000ms",
      respBody: "TIMEOUT: Connection timed out waiting for socket response",
    },
    {
      endpointId: ep1Id,
      endpointUrl: "https://api.northwind.io/hooks/billing",
      eventName: "invoice.paid",
      minutesAgo: 230,
      statusCode: null,
      isTimeout: false,
      latency: 86,
      lastError: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      respBody: "TLS handshake failed: UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    },
  ];

  // Insert 3 DLQ deliveries
  for (const dlq of dlqPlans) {
    const dlvId = `dlv_01J9DLQ_${deliveryIdx.toString(36).padStart(4, "0")}`;
    const evtId = `evt_01J9XK_DLQ_${deliveryIdx}`;
    deliveryIdx++;

    // Ensure matching event exists
    await migrationPool.query(
      `INSERT INTO events (id, org_id, event_name, payload, ingest_latency_ms, status_code, created_at)
       VALUES ($1, $2, $3, $4, 6.2, 202, NOW() - ($5 || ' minutes')::interval)
       ON CONFLICT (id) DO NOTHING`,
      [
        evtId,
        orgId,
        dlq.eventName,
        JSON.stringify({ id: evtId, type: dlq.eventName, amount_cents: 8900 }),
        dlq.minutesAgo + 5,
      ]
    );

    await migrationPool.query(
      `INSERT INTO webhook_deliveries (
         id, org_id, event_id, endpoint_id, event_name, endpoint_url,
         state, last_status_code, is_timeout, last_latency_ms,
         attempt_count, max_attempts, signature_prefix, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'DLQ', $7, $8, $9, 5, 5, 'sha256=9f2c41ab...', NOW() - ($10 || ' minutes')::interval, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        dlvId,
        orgId,
        evtId,
        dlq.endpointId,
        dlq.eventName,
        dlq.endpointUrl,
        dlq.statusCode,
        dlq.isTimeout,
        dlq.latency,
        dlq.minutesAgo,
      ]
    );

    // Insert 5 failed delivery attempts for DLQ lifecycle
    for (let att = 1; att <= 5; att++) {
      const attMinutesAgo = dlq.minutesAgo + (5 - att) * 10;
      await migrationPool.query(
        `INSERT INTO webhook_attempts (
           id, org_id, delivery_id, attempt_number, trigger,
           status_code, is_timeout, latency_ms,
           request_headers, request_body, response_headers, response_body,
           response_truncated, created_at
         ) VALUES ($1, $2, $3, $4, 'auto', $5, $6, $7, $8, $9, $10, $11, false, NOW() - ($12 || ' minutes')::interval)
         ON CONFLICT (id) DO NOTHING`,
        [
          `att_${dlvId}_${att}`,
          orgId,
          dlvId,
          att,
          dlq.statusCode,
          dlq.isTimeout,
          dlq.latency,
          JSON.stringify({
            "content-type": "application/json",
            "x-webhook-id": dlvId,
            "x-webhook-timestamp": Math.round(Date.now() / 1000 - attMinutesAgo * 60).toString(),
          }),
          JSON.stringify({ id: evtId, type: dlq.eventName }),
          JSON.stringify({ server: "eventpulse-dispatcher" }),
          dlq.respBody,
          attMinutesAgo,
        ]
      );
    }
  }

  // Insert 97 successful deliveries
  for (let i = 0; i < 97; i++) {
    const candidate = candidateEvents[i % candidateEvents.length];
    const isEp1 = candidate.name.startsWith("payment.") || candidate.name.startsWith("invoice.");
    const endpointId = isEp1 ? ep1Id : ep2Id;
    const endpointUrl = isEp1
      ? "https://api.northwind.io/hooks/billing"
      : "https://hooks.slackrelay.dev/events";

    const dlvId = `dlv_01J9OK_${deliveryIdx.toString(36).padStart(4, "0")}`;
    deliveryIdx++;

    const latency = Math.round(180 + prng() * 140);

    await migrationPool.query(
      `INSERT INTO webhook_deliveries (
         id, org_id, event_id, endpoint_id, event_name, endpoint_url,
         state, last_status_code, is_timeout, last_latency_ms,
         attempt_count, max_attempts, signature_prefix, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'DELIVERED', 200, false, $7, 1, 5, 'sha256=9f2c41ab...', NOW() - ($8 || ' minutes')::interval, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        dlvId,
        orgId,
        candidate.id,
        endpointId,
        candidate.name,
        endpointUrl,
        latency,
        candidate.minutesAgo,
      ]
    );

    await migrationPool.query(
      `INSERT INTO webhook_attempts (
         id, org_id, delivery_id, attempt_number, trigger,
         status_code, is_timeout, latency_ms,
         request_headers, request_body, response_headers, response_body,
         response_truncated, created_at
       ) VALUES ($1, $2, $3, 1, 'auto', 200, false, $4, $5, $6, $7, '{\"status\":\"delivered\",\"acknowledged\":true}', false, NOW() - ($8 || ' minutes')::interval)
       ON CONFLICT (id) DO NOTHING`,
      [
        `att_${dlvId}_1`,
        orgId,
        dlvId,
        latency,
        JSON.stringify({
          "content-type": "application/json",
          "x-webhook-id": dlvId,
          "x-webhook-timestamp": Math.round(Date.now() / 1000 - candidate.minutesAgo * 60).toString(),
        }),
        JSON.stringify({ id: candidate.id, type: candidate.name }),
        JSON.stringify({ server: "target-service", "content-type": "application/json" }),
        candidate.minutesAgo,
      ]
    );
  }

  logger.info("Database seeding completed with fresh timestamps and realistic distribution.");
}

// Standalone execution
const isMain =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    import.meta.url === pathToFileURL(process.argv[1]).href);

if (isMain) {
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
}
