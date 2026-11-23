import crypto from "crypto";
import { env } from "./env";
import { redis } from "./redis";
import { migrationPool } from "../db";
import { logger } from "./logger";

// 1. AES-256-GCM Encryption / Decryption for whsec_ secrets at rest
const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(env.ENCRYPTION_KEY_HEX, "hex"); // 32 bytes

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decryptSecret(encryptedPayload: string): string {
  const parts = encryptedPayload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }
  const [ivHex, authTagHex, cipherText] = parts;
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    KEY,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(cipherText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// 2. Base62 encoding for API key secrets
const BASE62_CHARS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function toBase62(buffer: Buffer): string {
  let result = "";
  for (let i = 0; i < buffer.length; i++) {
    result += BASE62_CHARS[buffer[i] % BASE62_CHARS.length];
  }
  return result;
}

// 3. API Key Generation: {prefix}_{env}_{32_bytes_base62}
// e.g. pk_live_8f2a... for INGEST and sk_live_... for ADMIN
export interface GeneratedApiKey {
  id: string;
  rawKey: string;
  prefix: string;
  keyHash: string;
  scope: "INGEST" | "ADMIN";
}

export function generateApiKey(
  scope: "INGEST" | "ADMIN",
  environment = "live"
): GeneratedApiKey {
  const scopePrefix = scope === "INGEST" ? "pk" : "sk";
  const randomBytes = crypto.randomBytes(32);
  const secretPart = toBase62(randomBytes);
  const rawKey = `${scopePrefix}_${environment}_${secretPart}`;
  const prefix = rawKey.slice(0, 12); // e.g. pk_live_8f2a
  const keyHash = hashApiKey(rawKey);
  const id = `key_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return {
    id,
    rawKey,
    prefix,
    keyHash,
    scope,
  };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export interface VerifiedApiKey {
  id: string;
  orgId: string;
  name: string;
  scope: "INGEST" | "ADMIN";
  rateLimitRpm: number;
}

/**
 * Verifies a Bearer API key using SHA-256 hash lookup.
 * Checks Redis cache-aside (apikey:{sha256}, TTL 60s) before falling back to PostgreSQL.
 * Debounces last_used_at update in Redis at most once every 5 minutes per key.
 */
export async function verifyApiKey(
  rawKey: string,
  requiredScope?: "INGEST" | "ADMIN"
): Promise<VerifiedApiKey | null> {
  if (!rawKey || (!rawKey.startsWith("pk_") && !rawKey.startsWith("sk_"))) {
    return null;
  }

  const keyHash = hashApiKey(rawKey);
  const cacheKey = `apikey:${keyHash}`;

  // 1. Check Redis cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached) as VerifiedApiKey;
      if (requiredScope && data.scope !== requiredScope && data.scope !== "ADMIN") {
        return null;
      }
      debounceLastUsed(data.id);
      return data;
    }
  } catch (err) {
    logger.warn({ err }, "Redis lookup failed during API key verification, falling back to DB");
  }

  // 2. Fallback to PostgreSQL lookup
  try {
    const query = `
      SELECT k.id, k.org_id, k.name, k.scope, k.revoked_at, k.expires_at, o.rate_limit_rpm
      FROM api_keys k
      JOIN organizations o ON o.id = k.org_id
      WHERE k.key_hash = $1
    `;
    const result = await migrationPool.query(query, [keyHash]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    // Check if revoked
    if (row.revoked_at) {
      return null;
    }

    // Check if expired
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return null;
    }

    const verified: VerifiedApiKey = {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      scope: row.scope,
      rateLimitRpm: row.rate_limit_rpm,
    };

    if (requiredScope && verified.scope !== requiredScope && verified.scope !== "ADMIN") {
      return null;
    }

    // Cache in Redis for 60 seconds
    try {
      await redis.set(cacheKey, JSON.stringify(verified), "EX", 60);
    } catch (err) {
      logger.warn({ err }, "Failed to cache verified API key in Redis");
    }

    debounceLastUsed(verified.id);
    return verified;
  } catch (err) {
    logger.error({ err }, "Database query error during API key verification");
    return null;
  }
}

/**
 * Revokes an API key: immediately purges it from Redis cache for sub-millisecond global effect.
 */
export async function invalidateApiKeyCache(keyHash: string): Promise<void> {
  try {
    await redis.del(`apikey:${keyHash}`);
  } catch (err) {
    logger.warn({ err }, "Failed to purge API key from Redis cache");
  }
}

/**
 * Debounce last_used_at in Redis and flush to PostgreSQL at most once every 5 minutes (300s).
 */
function debounceLastUsed(keyId: string): void {
  const debounceKey = `apikey:last_used:${keyId}`;
  redis
    .set(debounceKey, "1", "EX", 300, "NX")
    .then((res) => {
      if (res === "OK") {
        migrationPool
          .query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [keyId])
          .catch((err) => {
            logger.warn({ err, keyId }, "Failed to update API key last_used_at");
          });
      }
    })
    .catch(() => {});
}
