import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL connection string"),
  DATABASE_MIGRATION_URL: z.string().url("DATABASE_MIGRATION_URL must be a valid PostgreSQL connection string"),
  REDIS_URL: z.string().url("REDIS_URL must be a valid Redis connection string"),
  ENCRYPTION_KEY_HEX: z.string().length(64, "ENCRYPTION_KEY_HEX must be a 64-char hex string (32 bytes)"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  INGEST_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = envSchema.parse(process.env);
