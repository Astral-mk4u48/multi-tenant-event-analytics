import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrationPool } from "@/db";
import { runMigrations } from "@/db/migrate";
import { withOrgRls } from "@/server/auth/context";
import { events } from "@/server/db/schema";
import crypto from "crypto";

describe("Multi-Tenant RLS Scoping & Tenant Isolation", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    await runMigrations();
    orgA = crypto.randomUUID();
    orgB = crypto.randomUUID();

    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, 'Org A Isolation', 6000), ($3, $4, 'Org B Isolation', 3000)`,
      [orgA, `org-a-iso-${Date.now()}`, orgB, `org-b-iso-${Date.now()}`]
    );
  });

  afterAll(async () => {
    await migrationPool.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [orgA, orgB]);
  });

  it("prevents Org A context from reading Org B events", async () => {
    // 1. Insert event under Org B context
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

    // 2. Attempt read under Org A context
    const orgAEvents = await withOrgRls(orgA, async (tx) => {
      return await tx.select().from(events);
    });

    // Verify Org A never sees Org B's record
    const leakedRecord = orgAEvents.find((e) => e.orgId === orgB || e.id === eventIdB);
    expect(leakedRecord).toBeUndefined();
  });
});
