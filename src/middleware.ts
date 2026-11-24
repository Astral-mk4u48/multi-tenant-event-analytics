import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/auth/callback",
  "/api/healthz",
  "/api/v1/events",
  "/api/v1/events/batch",
  "/api/v1/auth/demo",
  "/api/v1/auth/login",
  "/api/v1/auth/signup",
  "/api/v1/auth/signout",
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const path = request.nextUrl.pathname;

  if (PUBLIC_ROUTES.includes(path) || path.startsWith("/auth/")) {
    return response;
  }

  // Allow Bearer API keys through on API routes for programmatic ingestion & management
  if (path.startsWith("/api/")) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return response;
    }
  }

  // Fast-path for signed session cookie without pulling Node dotenv into Edge runtime
  const sessionToken = request.cookies.get("session_token")?.value;
  if (sessionToken && sessionToken.includes(".")) {
    try {
      const [payloadBase64] = sessionToken.split(".");
      const decoded = JSON.parse(
        atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"))
      );
      if (decoded.exp && decoded.exp > Math.floor(Date.now() / 1000)) {
        return response;
      }
    } catch {
      // Malformed cookie falls through to standard validation
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let user = null;
  if (supabaseUrl && supabaseKey) {
    try {
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

      const res = await supabase.auth.getUser();
      user = res.data.user;
    } catch {
      // Supabase fetch failure
    }
  }

  if (!user && (path.startsWith("/dashboard") || path.startsWith("/api/v1/"))) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
