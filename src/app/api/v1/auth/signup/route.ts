import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { provisionNewUserAndOrg } from "@/server/db/provisioning";
import { signSession, SESSION_COOKIE_NAME } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const signupSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Valid work email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  orgName: z.string().min(1, "Organization name is required"),
  orgSlug: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid registration payload" },
        { status: 400 }
      );
    }

    const { fullName, email, orgName, orgSlug } = parsed.data;
    const cleanSlug =
      orgSlug?.trim() ||
      orgName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    const userId = crypto.randomUUID();

    const { user, org } = await provisionNewUserAndOrg({
      userId,
      email,
      fullName,
      orgName,
      orgSlug: cleanSlug,
    });

    const token = signSession({
      userId: user.id,
      orgId: org.id,
      role: "OWNER",
      email: user.email,
      name: user.name,
    });

    const res = NextResponse.json({
      success: true,
      redirect: "/dashboard",
      user: { id: user.id, email: user.email, name: user.name },
      org: { id: org.id, name: org.name, slug: org.slug },
    });

    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    res.cookies.set({
      name: "active_org_id",
      value: org.id,
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Registration failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
