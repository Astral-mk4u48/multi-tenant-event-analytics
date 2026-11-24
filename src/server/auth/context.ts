import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { db, withTenant } from "@/db";
import { orgMembers, organizations } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { verifySession, SESSION_COOKIE_NAME } from "./session";

export interface OrgContext {
  userId: string;
  email: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: "OWNER" | "ADMIN" | "VIEWER";
}

export async function getAuthenticatedOrgContext(): Promise<OrgContext> {
  const cookieStore = await cookies();

  let userId: string | null = null;
  let email: string | null = null;

  // 1. Check Supabase SSR session
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
        },
      });
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
        email = user.email || "";
      }
    } catch {
      // Supabase fetch failure fallback
    }
  }

  // 2. Check signed HMAC session token if Supabase SSR user not resolved
  if (!userId) {
    const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (rawToken) {
      const session = verifySession(rawToken);
      if (session) {
        userId = session.userId;
        email = session.email;
      }
    }
  }

  if (!userId) {
    throw new Error("UNAUTHORIZED");
  }

  const activeOrgId = cookieStore.get("active_org_id")?.value;
  let memberRecord;

  if (activeOrgId) {
    [memberRecord] = await db
      .select({
        orgId: orgMembers.orgId,
        role: orgMembers.role,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, activeOrgId)))
      .limit(1);
  }

  if (!memberRecord) {
    [memberRecord] = await db
      .select({
        orgId: orgMembers.orgId,
        role: orgMembers.role,
        orgName: organizations.name,
        orgSlug: organizations.slug,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(eq(orgMembers.userId, userId))
      .limit(1);
  }

  if (!memberRecord) {
    throw new Error("NO_ORGANIZATION_MEMBERSHIP");
  }

  return {
    userId,
    email: email || "user@eventpulse.dev",
    orgId: memberRecord.orgId,
    orgSlug: memberRecord.orgSlug,
    orgName: memberRecord.orgName,
    role: memberRecord.role as "OWNER" | "ADMIN" | "VIEWER",
  };
}

export async function withOrgRls<T>(
  orgId: string,
  callback: (tx: typeof db) => Promise<T>
): Promise<T> {
  return await withTenant(orgId, callback as unknown as Parameters<typeof withTenant>[1]) as T;
}
