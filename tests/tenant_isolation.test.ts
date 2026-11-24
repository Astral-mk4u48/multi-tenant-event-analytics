import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, migrationPool, withTenant } from "@/db";
import { runMigrations } from "@/db/migrate";
import { withOrgRls } from "@/server/auth/context";
import { events } from "@/server/db/schema";
import { POST as switchOrgRoute } from "@/app/api/v1/orgs/switch/route";
import { signSession } from "@/server/auth/session";
import { NextRequest } from "next/server";
import crypto from "crypto";

describe("Part 4: Multi-Tenant RLS Scoping & Tenant Isolation Verification", () => {
  let orgA: string;
  let orgB: string;
  let userA: string;
  let userB: string;
  let sessionCookieA: string;
  let sessionCookieB: string;

  beforeAll(async () => {
    await runMigrations();
    orgA = crypto.randomUUID();
    orgB = crypto.randomUUID();
    userA = crypto.randomUUID();
    userB = crypto.randomUUID();

    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, 'Org A Isolation', 6000), ($3, $4, 'Org B Isolation', 3000)`,
      [orgA, `org-a-iso-${Date.now()}`, orgB, `org-b-iso-${Date.now()}`]
    );

    await migrationPool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, $2, 'User A'), ($3, $4, 'User B')`,
      [userA, `user-a-${Date.now()}@test.internal`, userB, `user-b-${Date.now()}@test.internal`]
    );

    await migrationPool.query(
      `INSERT INTO org_memberships (user_id, org_id, role)
       VALUES ($1, $2, 'OWNER'), ($3, $4, 'OWNER')`,
      [userA, orgA, userB, orgB]
    );

    sessionCookieA = signSession({
      userId: userA,
      email: `user-a-${Date.now()}@test.internal`,
      orgId: orgA,
      role: "OWNER",
    });

    sessionCookieB = signSession({
      userId: userB,
      email: `user-b-${Date.now()}@test.internal`,
      orgId: orgB,
      role: "OWNER",
    });
  });

  afterAll(async () => {
    await migrationPool.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [orgA, orgB]);
    await migrationPool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userA, userB]);
  });

  it("prevents Org A context from reading Org B events", async () => {
    const eventIdB = `evt_iso_${crypto.randomBytes(8).toString("hex")}`;
    await withOrgRls(orgB, async (tx) => {
      await tx.insert(events).values({
        id: eventIdB,
        orgId: orgB,
        eventName: "user.created",
        payload: { user: "B", testTag: "isolation_check" },
        ingestLatencyMs: 1.5,
        statusCode: 202,
      });
    });

    const orgAEvents = await withOrgRls(orgA, async (tx) => {
      return await tx.select().from(events);
    });

    const leakedRecord = orgAEvents.find((e) => e.orgId === orgB || e.id === eventIdB);
    expect(leakedRecord).toBeUndefined();
  });

  it("SET LOCAL safety: verifies app.current_org_id is reset after transaction commit, preventing pooled connection leakage", async () => {
    const client = await pool.connect();
    try {
      // 1. Transaction 1 sets tenant context with set_config(..., true)
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgA]);
      const inTxRes = await client.query("SELECT current_setting('app.current_org_id', true) AS tenant");
      expect(inTxRes.rows[0].tenant).toBe(orgA);
      await client.query("COMMIT");

      // 2. Immediately after COMMIT on the SAME physical connection, setting must be unset
      const postTxRes = await client.query("SELECT current_setting('app.current_org_id', true) AS tenant");
      expect(postTxRes.rows[0].tenant === "" || postTxRes.rows[0].tenant === null).toBe(true);

      // 3. Executing a query as app_user with no tenant context returns zero rows due to RLS
      const eventsRes = await client.query("SELECT * FROM events");
      expect(eventsRes.rows.length).toBe(0);
    } finally {
      client.release();
    }
  });

  it("Active org spoofing: switching active_org_id rejects an unauthorized org with 403", async () => {
    // User A attempts to activate Org B (which they do not belong to)
    const spoofReq = new NextRequest("http://localhost:3000/api/v1/orgs/switch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `session_token=${sessionCookieA}`,
      },
      body: JSON.stringify({ orgId: orgB }),
    });

    const res = await switchOrgRoute(spoofReq);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Forbidden: You are not a member of this organization");
  });

  it("Two-tenant isolation: User A cannot read or mutate User B endpoints or keys", async () => {
    // Insert endpoint under Org B
    const epIdB = `ep_iso_${crypto.randomBytes(6).toString("hex")}`;
    await withTenant(orgB, async (tx) => {
      await tx.execute(
        `INSERT INTO webhook_endpoints (id, org_id, url, signing_secret, subscribed_events, is_active)
         VALUES ('${epIdB}', '${orgB}', 'https://api.partner-b.io/hook', 'whsec_secret_b', ARRAY['*']::text[], true)`
      );
    });

    // Verify Org A cannot query Org B endpoint
    await withTenant(orgA, async (tx) => {
      const readRes = await tx.execute(`SELECT * FROM webhook_endpoints WHERE id = '${epIdB}'`);
      expect(readRes.rows.length).toBe(0);

      const updateRes = await tx.execute(
        `UPDATE webhook_endpoints SET url = 'https://hacked.com' WHERE id = '${epIdB}'`
      );
      expect(updateRes.rowCount).toBe(0);
    });
  });
});
