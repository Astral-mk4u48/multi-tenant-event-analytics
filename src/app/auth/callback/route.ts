import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { provisionNewUserAndOrg } from "@/server/db/provisioning";
import { migrationPool } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/dashboard";

  let response = NextResponse.redirect(new URL(next, request.url));

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
        // Check if user already exists in Postgres
        const existing = await migrationPool.query(
          `SELECT id FROM users WHERE id = $1 LIMIT 1`,
          [user.id]
        );

        if (existing.rows.length === 0) {
          const fullName =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email?.split("@")[0] ||
            "Operator";
          const orgName = user.user_metadata?.org_name || `${fullName}'s Workspace`;
          const orgSlug =
            user.user_metadata?.org_slug ||
            orgName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");

          const { org } = await provisionNewUserAndOrg({
            userId: user.id,
            email: user.email || "",
            fullName,
            orgName,
            orgSlug,
          });

          response.cookies.set("active_org_id", org.id, {
            path: "/",
            httpOnly: false,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
        }
      }
    }
  }

  return response;
}
