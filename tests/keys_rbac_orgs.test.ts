import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrationPool } from "@/db";
import { runMigrations } from "@/db/migrate";
import { generateApiKey, verifyApiKey, invalidateApiKeyCache } from "@/server/crypto";
import { signSession } from "@/server/auth/session";
import { POST as createKeyRoute, GET as getKeysRoute } from "@/app/api/v1/keys/route";
import { DELETE as deleteKeyRoute } from "@/app/api/v1/keys/[id]/route";
import { NextRequest } from "next/server";
import crypto from "crypto";

describe("Milestone C: Tenant API Keys, RBAC, and Organization Management", () => {
  let testOrgId: string;
  let ownerUserId: string;
  let viewerUserId: string;
  let ownerSessionToken: string;
  let viewerSessionToken: string;

  beforeAll(async () => {
    await runMigrations();

    testOrgId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    viewerUserId = crypto.randomUUID();

    await migrationPool.query(
      `INSERT INTO organizations (id, slug, name, rate_limit_rpm)
       VALUES ($1, $2, 'RBAC Test Org', 6000)`,
      [testOrgId, `rbac-org-${Date.now()}`]
    );

    await migrationPool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, $2, 'Owner User'), ($3, $4, 'Viewer User')`,
      [ownerUserId, `owner-${Date.now()}@example.com`, viewerUserId, `viewer-${Date.now()}@example.com`]
    );

    await migrationPool.query(
      `INSERT INTO org_memberships (org_id, user_id, role)
       VALUES ($1, $2, 'OWNER'), ($1, $3, 'VIEWER')`,
      [testOrgId, ownerUserId, viewerUserId]
    );

    ownerSessionToken = signSession({
      userId: ownerUserId,
      orgId: testOrgId,
      role: "OWNER",
      email: `owner-${Date.now()}@example.com`,
      name: "Owner User",
    });

    viewerSessionToken = signSession({
      userId: viewerUserId,
      orgId: testOrgId,
      role: "VIEWER",
      email: `viewer-${Date.now()}@example.com`,
      name: "Viewer User",
    });
  });

  afterAll(async () => {
    await migrationPool.query(`DELETE FROM organizations WHERE id = $1`, [testOrgId]);
    await migrationPool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [ownerUserId, viewerUserId]);
  });

  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/keys");
    const res = await getKeysRoute(req);
    expect(res.status).toBe(401);
  });

  it("rejects VIEWER role key creation with 403 Forbidden", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `session_token=${viewerSessionToken}`,
      },
      body: JSON.stringify({ name: "Viewer Attempt", scope: "INGEST" }),
    });

    const res = await createKeyRoute(req);
    expect(res.status).toBe(403);
  });

  it("allows OWNER to generate API key and receive rawKey once", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `session_token=${ownerSessionToken}`,
      },
      body: JSON.stringify({ name: "Production Ingestion Key", scope: "INGEST" }),
    });

    const res = await createKeyRoute(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.prefix).toMatch(/^pk_live_/);
    expect(body.rawKey).toMatch(/^pk_live_/);

    // Verify key validates against crypto verifier
    const verified = await verifyApiKey(body.rawKey);
    expect(verified).not.toBeNull();
    expect(verified?.orgId).toBe(testOrgId);

    // Now revoke key
    const deleteReq = new NextRequest(`http://localhost:3000/api/v1/keys/${body.id}`, {
      method: "DELETE",
      headers: {
        Cookie: `session_token=${ownerSessionToken}`,
      },
    });
    const delRes = await deleteKeyRoute(deleteReq, { params: Promise.resolve({ id: body.id }) });
    expect(delRes.status).toBe(200);

    // Immediate re-verification fails
    const recheck = await verifyApiKey(body.rawKey);
    expect(recheck).toBeNull();
  });
});
