import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { provisionNewUserAndOrg } from "@/server/db/provisioning";
import { migrationPool } from "@/db";
import { GET as authCallbackRoute } from "@/app/auth/callback/route";
import { NextRequest } from "next/server";
import crypto from "crypto";

describe("Part 6: Google OAuth Callback & Tenancy Provisioning", () => {
  let createdOrgIds: string[] = [];
  let createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdOrgIds.length > 0) {
      await migrationPool.query(
        `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
        [createdOrgIds]
      );
    }
    if (createdUserIds.length > 0) {
      await migrationPool.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[])`,
        [createdUserIds]
      );
    }
  });

  it("first-time provisioning: creates user, org with derived slug, and owner membership", async () => {
    const userId = crypto.randomUUID();
    const email = `new-user-${Date.now()}@example.com`;
    const fullName = "Devon Vance";

    const { user, org } = await provisionNewUserAndOrg({
      userId,
      email,
      fullName,
      orgName: `${fullName}'s Workspace`,
      orgSlug: "devon-vance",
    });

    createdOrgIds.push(org.id);
    createdUserIds.push(user.id);

    expect(user.id).toBe(userId);
    expect(user.email).toBe(email);
    expect(org.name).toBe("Devon Vance's Workspace");
    expect(org.slug).toMatch(/^devon-vance/);

    // Verify membership was recorded in DB
    const memberRes = await migrationPool.query(
      `SELECT role FROM org_memberships WHERE user_id = $1 AND org_id = $2`,
      [userId, org.id]
    );
    expect(memberRes.rows.length).toBe(1);
    expect(memberRes.rows[0].role).toBe("OWNER");
  });

  it("duplicate callback idempotency: double-fired callback does not create duplicate orgs", async () => {
    const userId = crypto.randomUUID();
    const email = `idempotent-${Date.now()}@example.com`;

    const first = await provisionNewUserAndOrg({
      userId,
      email,
      fullName: "Maya Lin",
      orgName: "Maya Lin's Workspace",
      orgSlug: "maya-lin",
    });
    createdOrgIds.push(first.org.id);
    createdUserIds.push(first.user.id);

    // Simulated immediate second callback / refresh
    const second = await provisionNewUserAndOrg({
      userId,
      email,
      fullName: "Maya Lin",
      orgName: "Maya Lin's Workspace",
      orgSlug: "maya-lin",
    });

    expect(second.org.id).toBe(first.org.id);
    expect(second.user.id).toBe(first.user.id);

    // Check count of orgs owned by this user
    const countRes = await migrationPool.query(
      `SELECT COUNT(*)::int AS count FROM org_memberships WHERE user_id = $1`,
      [userId]
    );
    expect(countRes.rows[0].count).toBe(1);
  });

  it("returning user with email/password signs in with Google using same verified email: lands in existing org", async () => {
    const existingUserId = crypto.randomUUID();
    const commonEmail = `shared-email-${Date.now()}@example.com`;

    // 1. User initially registered via email/password
    const emailRegistration = await provisionNewUserAndOrg({
      userId: existingUserId,
      email: commonEmail,
      fullName: "Alex Rivera",
      orgName: "Rivera Capital",
      orgSlug: `rivera-cap-${Date.now()}`,
    });
    createdOrgIds.push(emailRegistration.org.id);
    createdUserIds.push(existingUserId);

    // 2. Later, user signs in with Google using the same verified email (simulated OAuth user ID)
    const googleUserId = crypto.randomUUID();
    const googleLogin = await provisionNewUserAndOrg({
      userId: googleUserId,
      email: commonEmail,
      fullName: "Alex Rivera",
      orgName: "Alex Rivera's Workspace",
      orgSlug: "alex-rivera",
    });

    // Must resolve to the existing org and user, not creating a duplicate tenant
    expect(googleLogin.org.id).toBe(emailRegistration.org.id);
    expect(googleLogin.user.email).toBe(commonEmail);

    const totalOrgs = await migrationPool.query(
      `SELECT COUNT(*)::int AS count FROM organizations WHERE id = $1`,
      [emailRegistration.org.id]
    );
    expect(totalOrgs.rows[0].count).toBe(1);
  });

  it("slug collision: appends random suffix when slug already exists", async () => {
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    const commonSlug = `unique-corp-${Date.now()}`;

    const resA = await provisionNewUserAndOrg({
      userId: userA,
      email: `corp-a-${Date.now()}@example.com`,
      fullName: "Corp A",
      orgName: "Corp A",
      orgSlug: commonSlug,
    });
    createdOrgIds.push(resA.org.id);
    createdUserIds.push(userA);

    const resB = await provisionNewUserAndOrg({
      userId: userB,
      email: `corp-b-${Date.now()}@example.com`,
      fullName: "Corp B",
      orgName: "Corp B",
      orgSlug: commonSlug,
    });
    createdOrgIds.push(resB.org.id);
    createdUserIds.push(userB);

    expect(resA.org.slug).toBe(commonSlug);
    expect(resB.org.slug).toMatch(new RegExp(`^${commonSlug}-[a-z0-9]+`));
    expect(resB.org.id).not.toBe(resA.org.id);
  });

  it("bad next validation: rejects open redirect URLs and defaults safely to /dashboard", async () => {
    const badUrls = [
      "https://evil.com/phish",
      "//evil.com",
      "\\\\evil.com",
      "javascript:alert(1)",
    ];

    for (const badNext of badUrls) {
      const req = new NextRequest(`http://localhost:3000/auth/callback?next=${encodeURIComponent(badNext)}`);
      const res = await authCallbackRoute(req);
      const location = res.headers.get("location") || "";
      const parsed = new URL(location);
      expect(parsed.pathname).toBe("/dashboard");
    }

    // Valid relative path is preserved
    const goodReq = new NextRequest("http://localhost:3000/auth/callback?next=/dashboard/events");
    const goodRes = await authCallbackRoute(goodReq);
    const goodLocation = goodRes.headers.get("location") || "";
    const goodParsed = new URL(goodLocation);
    expect(goodParsed.pathname).toBe("/dashboard/events");
  });
});
