import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { provisionNewUserAndOrg } from "@/server/db/provisioning";
import { migrationPool } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextParam = requestUrl.searchParams.get("next") || "/dashboard";

  // Validate next parameter: same-origin relative paths only (reject //, http:, https:, \)
  const safeNext =
    nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("\\")
      ? nextParam
      : "/dashboard";

  let response = NextResponse.redirect(new URL(safeNext, request.url));

  if (code) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              response.cookies.set(name, value, options);
            });
          },
        },
      });

      const { data: { user } } = await supabase.auth.exchangeCodeForSession(code);

      if (user) {
        // 1. Check if user already has an org membership (by user.id OR by verified email)
        const existingMember = await migrationPool.query(
          `SELECT m.org_id, m.role, u.id AS existing_user_id
           FROM users u
           JOIN org_memberships m ON m.user_id = u.id
           WHERE u.id = $1 OR u.email = $2
           ORDER BY m.last_active_at DESC NULLS LAST
           LIMIT 1`,
          [user.id, user.email || ""]
        );

        if (existingMember.rows.length > 0) {
          // Returning user: land in their existing organization without duplicate provisioning
          const existingOrgId = existingMember.rows[0].org_id;

          // If user logged in via Google with same email but different provider user.id, ensure user record matches
          if (existingMember.rows[0].existing_user_id !== user.id) {
            await migrationPool.query(
              `INSERT INTO org_memberships (user_id, org_id, role, last_active_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (org_id, user_id) DO UPDATE SET last_active_at = NOW()`,
              [user.id, existingOrgId, existingMember.rows[0].role]
            );
          }

          response.cookies.set("active_org_id", existingOrgId, {
            path: "/",
            httpOnly: false,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 7 * 24 * 60 * 60,
          });
        } else {
          // First-time provisioning: derive default org name and clean kebab slug
          const fullName =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email?.split("@")[0] ||
            "Operator";
          const orgName = `${fullName}'s Workspace`;
          const baseSlug = fullName
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "") || "workspace";

          const { org } = await provisionNewUserAndOrg({
            userId: user.id,
            email: user.email || "",
            fullName,
            orgName,
            orgSlug: baseSlug,
          });

          response.cookies.set("active_org_id", org.id, {
            path: "/",
            httpOnly: false,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 7 * 24 * 60 * 60,
          });
        }
      }
    }
  }

  return response;
}
