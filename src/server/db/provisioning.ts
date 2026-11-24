import { migrationDb } from "@/db";
import { users, organizations, orgMembers } from "@/server/db/schema";
import { eq, sql } from "drizzle-orm";

export async function provisionNewUserAndOrg(params: {
  userId: string;
  email: string;
  fullName: string;
  orgName: string;
  orgSlug: string;
}) {
  // Use migrationDb to safely bootstrap new tenant records across RLS boundaries
  return await migrationDb.transaction(async (tx) => {
    // 1. Upsert base user record
    const [userRecord] = await tx
      .insert(users)
      .values({
        id: params.userId,
        email: params.email,
        name: params.fullName,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { name: params.fullName, email: params.email },
      })
      .returning();

    // 2. Generate clean kebab slug and guarantee uniqueness
    let cleanSlug = params.orgSlug
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!cleanSlug) cleanSlug = "workspace";

    const existing = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, cleanSlug))
      .limit(1);

    if (existing.length > 0) {
      cleanSlug = `${cleanSlug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    const [orgRecord] = await tx
      .insert(organizations)
      .values({
        name: params.orgName,
        slug: cleanSlug,
        createdAt: new Date(),
      })
      .returning();

    // 3. Set transaction tenant scope before inserting membership
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgRecord.id}, true)`);

    // 4. Associate newly provisioned user as OWNER
    await tx.insert(orgMembers).values({
      orgId: orgRecord.id,
      userId: userRecord.id,
      role: "OWNER",
      joinedAt: new Date(),
    });

    return { user: userRecord, org: orgRecord };
  });
}
