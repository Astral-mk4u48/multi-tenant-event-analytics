import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { verifyApiKey } from "../crypto";
import { verifySession, SESSION_COOKIE_NAME } from "./session";
import { Role, hasPermission, Capability } from "./rbac";
import { migrationPool } from "@/db";

export interface AuthContext {
  orgId: string;
  role: Role;
  userId?: string;
  keyId?: string;
  email?: string;
  isDemo?: boolean;
  authType: "api_key" | "session";
}

/**
 * Resolves authentication context from Bearer API key or session cookie.
 * No hardcoded tenant fallbacks: requests without valid credentials return null.
 */
export async function resolveAuth(req: NextRequest): Promise<AuthContext | null> {
  // 1. Check Bearer token (API Key)
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const rawKey = authHeader.slice(7).trim();
    const apiKey = await verifyApiKey(rawKey);
    if (apiKey) {
      const role: Role = apiKey.scope === "ADMIN" ? "ADMIN" : "VIEWER";
      return {
        orgId: apiKey.orgId,
        role,
        keyId: apiKey.id,
        authType: "api_key",
      };
    }
    return null;
  }

  // 2. Check signed HMAC Session Cookie
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie) {
    const session = verifySession(cookie);
    if (session) {
      return {
        orgId: session.orgId,
        role: session.role,
        userId: session.userId,
        email: session.email,
        isDemo: session.isDemo || session.email === "demo@eventpulse.dev",
        authType: "session",
      };
    }
  }

  // 3. Check Supabase SSR session
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
        },
      });

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const activeOrgId = req.cookies.get("active_org_id")?.value;
        const query = activeOrgId
          ? `SELECT org_id, role FROM org_memberships WHERE user_id = $1 AND org_id = $2 LIMIT 1`
          : `SELECT org_id, role FROM org_memberships WHERE user_id = $1 LIMIT 1`;
        const params = activeOrgId ? [user.id, activeOrgId] : [user.id];

        const res = await migrationPool.query(query, params);
        if (res.rows.length > 0) {
          return {
            orgId: res.rows[0].org_id,
            role: res.rows[0].role as Role,
            userId: user.id,
            authType: "session",
          };
        }
      }
    } catch {
      // Supabase fetch failure
    }
  }

  return null;
}

/**
 * Helper to enforce RBAC capability checks.
 */
export function checkCapability(auth: AuthContext, capability: Capability): boolean {
  return hasPermission(auth.role, capability);
}
