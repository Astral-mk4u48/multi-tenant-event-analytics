import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    logger.error(
      {
        err: {
          message: body.message,
          stack: body.stack,
        },
        digest: body.digest,
      },
      "Unhandled client runtime exception captured in error boundary"
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to log client error" }, { status: 400 });
  }
}
