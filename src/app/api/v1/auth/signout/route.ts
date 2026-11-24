import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleSignout(req);
}

export async function GET(req: NextRequest) {
  return handleSignout(req);
}

function handleSignout(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url));

  res.cookies.delete(SESSION_COOKIE_NAME);
  res.cookies.delete("active_org_id");

  // Expire cookies across client browsers
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set({
    name: "active_org_id",
    value: "",
    path: "/",
    maxAge: 0,
  });

  return res;
}
