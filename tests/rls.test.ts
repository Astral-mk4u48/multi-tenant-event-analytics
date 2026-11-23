import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, migrationPool, withTenant } from "../src/db";
import { runMigrations } from "../src/db/migrate";
import {
  encryptSecret,
  decryptSecret,
  generateApiKey,
  verifyApiKey,
  invalidateApiKeyCache,
} from "../src/server/crypto";
import { signSession, verifySession } from "../src/server/auth/session";
import { hasPermission } from "../src/server/auth/rbac";
import { redis } from "../src/server/redis";
import crypto from "crypto";

describe("Phase 1: Multi-Tenancy, RLS, Cryptography, and Auth Integration Suite", () => {
  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    // Ensure migrations have executed
    await runMigrations();

    // Create 2 distinct organizations for tenant isolation testing
    orgAId = crypto.randomUUID();
    orgBId = crypto.randomUUID();
    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();

    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, $3, 6000), ($4, $5, $6, 3000)`,
      [orgAId, `org-a-${Date.now()}`, "Organization A", orgBId, `org-b-${Date.now()}`, "Organization B"]
    );

    await migrationPool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, $2, $3), ($4, $5, $6)`,
      [userAId, `alice-${Date.now()}@example.com`, "Alice", userBId, `bob-${Date.now()}@example.com`, "Bob"]
    );

    await migrationPool.query(
      `INSERT INTO org_memberships (user_id, org_id, role)
       VALUES ($1, $2, 'OWNER'), ($3, $4, 'OWNER')`,
      [userAId, orgAId, userBId, orgBId]
    );
  });

  afterAll(async () => {
    // Cleanup seeded orgs
    await migrationPool.query("DELETE FROM organizations WHERE id IN ($1, $2)", [orgAId, orgBId]);
    await migrationPool.query("DELETE FROM users WHERE id IN ($1, $2)", [userAId, userBId]);
    await pool.end();
    await migrationPool.end();
    redis.disconnect();
  });

  describe("Row-Level Security (RLS) Tenant Isolation", () => {
    it("strictly isolates events: Org A cannot read or mutate Org B events", async () => {
      const eventBId = `evt_${Date.now()}_b`;

      // Insert event for Org B using Org B tenant context
      await withTenant(orgBId, async (tx) => {
        await tx.execute(
          `INSERT INTO events (id, org_id, event_name, payload, ingest_latency_ms, status_code)
           VALUES ('${eventBId}', '${orgBId}', 'payment.completed', '{"amount": 100}', 12.5, 202)`
        );
      });

      // Try reading Org B's event under Org A's tenant context
      await withTenant(orgAId, async (tx) => {
        const res = await tx.execute(`SELECT * FROM events WHERE id = '${eventBId}'`);
        expect(res.rows.length).toBe(0);

        // Try updating Org B's event under Org A's tenant context
        const updateRes = await tx.execute(
          `UPDATE events SET event_name = 'hacked' WHERE id = '${eventBId}'`
        );
        expect(updateRes.rowCount).toBe(0);

        // Try deleting Org B's event under Org A's tenant context
        const delRes = await tx.execute(`DELETE FROM events WHERE id = '${eventBId}'`);
        expect(delRes.rowCount).toBe(0);
      });

      // Verify Org B's event remains intact
      await withTenant(orgBId, async (tx) => {
        const res = await tx.execute(`SELECT * FROM events WHERE id = '${eventBId}'`);
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].event_name).toBe("payment.completed");
      });
    });

    it("rejects cross-tenant inserts with an RLS policy violation check", async () => {
      const crossTenantEventId = `evt_${Date.now()}_cross`;

      // Under Org A context, attempt to insert a row with org_id = orgBId
      await expect(
        withTenant(orgAId, async (tx) => {
          await tx.execute(
            `INSERT INTO events (id, org_id, event_name, payload, ingest_latency_ms, status_code)
             VALUES ('${crossTenantEventId}', '${orgBId}', 'user.fraud', '{}', 1.0, 202)`
          );
        })
      ).rejects.toThrow();
    });

    it("strictly isolates webhook endpoints and deliveries across tenants", async () => {
      const epBId = `ep_${Date.now()}_b`;
      const dlvBId = `dlv_${Date.now()}_b`;

      await withTenant(orgBId, async (tx) => {
        await tx.execute(
          `INSERT INTO webhook_endpoints (id, org_id, url, subscribed_events, signing_secret)
           VALUES ('${epBId}', '${orgBId}', 'https://example.com/b', ARRAY['order.*'], 'secret')`
        );
        await tx.execute(
          `INSERT INTO webhook_deliveries (id, org_id, event_name, endpoint_url, state, signature_prefix)
           VALUES ('${dlvBId}', '${orgBId}', 'order.created', 'https://example.com/b', 'QUEUED', 'sha256=1234')`
        );
      });

      // Org A queries should yield 0 results
      await withTenant(orgAId, async (tx) => {
        const endpoints = await tx.execute(`SELECT * FROM webhook_endpoints WHERE id = '${epBId}'`);
        expect(endpoints.rows.length).toBe(0);

        const deliveries = await tx.execute(`SELECT * FROM webhook_deliveries WHERE id = '${dlvBId}'`);
        expect(deliveries.rows.length).toBe(0);
      });
    });

    it("enforces trigger preventing demoting or deleting the final OWNER of an organization", async () => {
      // Attempting to delete the only OWNER of orgA
      await expect(
        migrationPool.query(
          "DELETE FROM org_memberships WHERE org_id = $1 AND user_id = $2",
          [orgAId, userAId]
        )
      ).rejects.toThrow(/Cannot demote or delete the final OWNER/);

      // Attempting to demote the only OWNER of orgA to VIEWER
      await expect(
        migrationPool.query(
          "UPDATE org_memberships SET role = 'VIEWER' WHERE org_id = $1 AND user_id = $2",
          [orgAId, userAId]
        )
      ).rejects.toThrow(/Cannot demote or delete the final OWNER/);
    });
  });

  describe("Cryptography & API Key Verification", () => {
    it("encrypts and decrypts whsec_ signing secrets using AES-256-GCM", () => {
      const rawSecret = "whsec_01J9XK3M7Q8N2A4B6C8D0E2F4";
      const encrypted = encryptSecret(rawSecret);
      expect(encrypted).not.toBe(rawSecret);
      expect(encrypted.split(":").length).toBe(3);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(rawSecret);
    });

    it("generates, hashes, stores, and verifies scoped API keys with Redis caching", async () => {
      const generated = generateApiKey("INGEST");
      expect(generated.rawKey.startsWith("pk_live_")).toBe(true);
      expect(generated.prefix.length).toBe(12);
      expect(generated.keyHash.length).toBe(64);

      // Store in DB under Org A
      await migrationPool.query(
        `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, scope)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [generated.id, orgAId, "Ingest Test Key", generated.prefix, generated.keyHash, generated.scope]
      );

      // 1. Verify API key (cache miss -> hits DB and sets Redis cache)
      const verified1 = await verifyApiKey(generated.rawKey, "INGEST");
      expect(verified1).not.toBeNull();
      expect(verified1?.id).toBe(generated.id);
      expect(verified1?.orgId).toBe(orgAId);
      expect(verified1?.scope).toBe("INGEST");

      // Verify it was cached in Redis
      const cached = await redis.get(`apikey:${generated.keyHash}`);
      expect(cached).not.toBeNull();

      // 2. Verify API key from cache
      const verified2 = await verifyApiKey(generated.rawKey, "INGEST");
      expect(verified2?.id).toBe(generated.id);

      // 3. Invalidate cache on key revocation
      await invalidateApiKeyCache(generated.keyHash);
      const afterRevokeCache = await redis.get(`apikey:${generated.keyHash}`);
      expect(afterRevokeCache).toBeNull();
    });
  });

  describe("Session Auth & RBAC Permissions Matrix", () => {
    it("signs and verifies HMAC-SHA256 session tokens", () => {
      const sessionData = {
        userId: userAId,
        orgId: orgAId,
        role: "OWNER" as const,
        email: "alice@example.com",
        name: "Alice",
      };

      const token = signSession(sessionData);
      expect(typeof token).toBe("string");

      const decoded = verifySession(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.userId).toBe(userAId);
      expect(decoded?.role).toBe("OWNER");

      // Tampered token check
      const tampered = token.slice(0, -4) + "ffff";
      expect(verifySession(tampered)).toBeNull();
    });

    it("enforces RBAC permissions correctly according to the spec matrix", () => {
      // OWNER has full access
      expect(hasPermission("OWNER", "manage_webhooks")).toBe(true);
      expect(hasPermission("OWNER", "purge_dlq")).toBe(true);
      expect(hasPermission("OWNER", "manage_keys")).toBe(true);
      expect(hasPermission("OWNER", "delete_organization")).toBe(true);

      // ADMIN has operational access but cannot delete organization
      expect(hasPermission("ADMIN", "manage_webhooks")).toBe(true);
      expect(hasPermission("ADMIN", "purge_dlq")).toBe(true);
      expect(hasPermission("ADMIN", "delete_organization")).toBe(false);

      // VIEWER is strictly read-only
      expect(hasPermission("VIEWER", "view_analytics")).toBe(true);
      expect(hasPermission("VIEWER", "inspect_payloads")).toBe(true);
      expect(hasPermission("VIEWER", "manage_webhooks")).toBe(false);
      expect(hasPermission("VIEWER", "replay_webhooks")).toBe(false);
      expect(hasPermission("VIEWER", "purge_dlq")).toBe(false);
      expect(hasPermission("VIEWER", "manage_keys")).toBe(false);
    });
  });
});
