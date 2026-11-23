import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: Redis | undefined;
}

export const redis =
  global.__redisClient ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });

redis.on("error", (err) => {
  logger.error({ err }, "Redis connection error");
});

if (process.env.NODE_ENV !== "production") {
  global.__redisClient = redis;
}
