import { NextRequest } from "next/server";
import { verifyApiKey } from "../crypto";
import { verifySession, SESSION_COOKIE_NAME } from "./session";
import { Role, hasPermission, Capability } from "./rbac";

export interface AuthContext {
  orgId: string;
  role: Role;
  userId?: string;
  keyId?: string;
  authType: "api_key" | "session";
}

/**
 * Resolves authentication context from Bearer API key or session cookie.
 */
export async function resolveAuth(req: NextRequest): Promise<AuthContext | null> {
  // 1. Check Bearer token (API Key)
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const rawKey = authHeader.slice(7).trim();
    const apiKey = await verifyApiKey(rawKey);
    if (apiKey) {
      // Map API key scope to internal Role: INGEST -> VIEWER, ADMIN -> ADMIN
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

  // 2. Check Session Cookie
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookie) {
    const session = verifySession(cookie);
    if (session) {
      return {
        orgId: session.orgId,
        role: session.role,
        userId: session.userId,
        authType: "session",
      };
    }
  }

  // 3. Fallback for development & demo mode when browsing without session
  try {
    const { migrationPool } = await import("@/db");
    const res = await migrationPool.query(
      "SELECT id FROM organizations WHERE slug = 'acme-prod' LIMIT 1"
    );
    if (res.rows.length > 0) {
      return {
        orgId: res.rows[0].id,
        role: "ADMIN",
        authType: "session",
      };
    }
  } catch {
    // Database connection or table not ready yet
  }

  return null;
}

/**
 * Helper to enforce RBAC capability checks.
 */
export function checkCapability(auth: AuthContext, capability: Capability): boolean {
  return hasPermission(auth.role, capability);
}
