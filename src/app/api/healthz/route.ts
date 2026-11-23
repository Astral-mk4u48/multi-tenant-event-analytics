import { NextResponse } from "next/server";
import { pool } from "@/db";
import { redis } from "@/server/redis";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const startTime = Date.now();
  let dbStatus = "ok";
  let redisStatus = "ok";
  let isHealthy = true;

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    dbStatus = "error";
    isHealthy = false;
    logger.error({ err }, "Database health check failed");
  }

  try {
    const pong = await redis.ping();
    if (pong !== "PONG") {
      redisStatus = "unexpected_response";
      isHealthy = false;
    }
  } catch (err) {
    redisStatus = "error";
    isHealthy = false;
    logger.error({ err }, "Redis health check failed");
  }

  const durationMs = Date.now() - startTime;

  if (!isHealthy) {
    return NextResponse.json(
      {
        status: "unhealthy",
        durationMs,
        checks: {
          database: dbStatus,
          redis: redisStatus,
        },
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      status: "healthy",
      durationMs,
      checks: {
        database: dbStatus,
        redis: redisStatus,
      },
    },
    { status: 200 }
  );
}
