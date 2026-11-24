import { NextRequest, NextResponse } from "next/server";
import { seed } from "../../../../../scripts/seed";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const cronSecret = process.env.CRON_SECRET;

  const isAuthorized =
    isVercelCron ||
    (cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isAuthorized) {
    logger.warn({ ip: req.headers.get("x-forwarded-for") }, "Unauthorized cron reseed attempt rejected");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await seed();
    logger.info("Daily demo workspace reseed completed via cron route");
    return NextResponse.json({
      status: "ok",
      reseededAt: new Date().toISOString(),
      message: "Demo workspace rolled forward successfully",
    });
  } catch (error: unknown) {
    logger.error({ err: error }, "Failed to execute demo reseed via cron");
    return NextResponse.json(
      { error: "Reseed failed", message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
