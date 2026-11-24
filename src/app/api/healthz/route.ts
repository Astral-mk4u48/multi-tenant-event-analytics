import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { sql } from "drizzle-orm";
import { redis } from "@/server/redis";
import { redisCircuitBreaker } from "@/server/redis-circuit-breaker";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  let redisOk = false;
  let ingestWorkerOk = false;
  let webhookWorkerOk = false;

  const withTimeout = <T>(promise: Promise<T>, ms = 1500): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Health check timeout")), ms)),
    ]);

  // 1. PostgreSQL Database Ping
  try {
    await withTimeout(db.execute(sql`SELECT 1`));
    dbOk = true;
  } catch (e) {
    logger.error({ err: e }, "Database health ping failed");
  }

  // 2. Redis and Worker Heartbeats via Redis Circuit Breaker
  if (redisCircuitBreaker.getState() === "OPEN") {
    redisOk = false;
  } else {
    try {
      const ping = await redisCircuitBreaker.execute(() => withTimeout(redis.ping()));
      redisOk = ping === "PONG";

      const ingestExists = await redisCircuitBreaker.execute(() =>
        withTimeout(redis.exists("worker:heartbeat:ingest"))
      );
      const webhookExists = await redisCircuitBreaker.execute(() =>
        withTimeout(redis.exists("worker:heartbeat:webhook"))
      );

      ingestWorkerOk = ingestExists === 1;
      webhookWorkerOk = webhookExists === 1;
    } catch (e) {
      logger.error({ err: e }, "Redis / Worker heartbeat check failed");
    }
  }

  const isHealthy = dbOk && redisOk && ingestWorkerOk && webhookWorkerOk;

  return NextResponse.json(
    {
      status: isHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      checks: {
        database: dbOk ? "up" : "down",
        redis: redisCircuitBreaker.getState() === "OPEN" ? "circuit_open" : (redisOk ? "up" : "down"),
        ingestWorker: ingestWorkerOk ? "active" : "inactive",
        webhookWorker: webhookWorkerOk ? "active" : "inactive",
      },
    },
    { status: isHealthy ? 200 : 503 }
  );
}
