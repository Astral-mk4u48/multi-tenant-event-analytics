import crypto from "crypto";
import { env } from "../env";

export interface SessionPayload {
  userId: string;
  orgId: string;
  role: "OWNER" | "ADMIN" | "VIEWER";
  email: string;
  name: string;
  isDemo?: boolean;
  exp: number; // Unix timestamp in seconds
}

export const SESSION_COOKIE_NAME = "session_token";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Sign session payload with HMAC-SHA256: payloadBase64.signatureHex
 */
export function signSession(
  payload: Omit<SessionPayload, "exp">,
  ttlSeconds = SESSION_TTL_SECONDS
): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const json = JSON.stringify(fullPayload);
  const payloadBase64 = Buffer.from(json).toString("base64url");
  const signature = crypto
    .createHmac("sha256", env.AUTH_SECRET)
    .update(payloadBase64)
    .digest("hex");

  return `${payloadBase64}.${signature}`;
}

/**
 * Verify session token and check expiration
 */
export function verifySession(token: string): SessionPayload | null {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payloadBase64, providedSig] = token.split(".");
  if (!payloadBase64 || !providedSig) {
    return null;
  }

  const expectedSig = crypto
    .createHmac("sha256", env.AUTH_SECRET)
    .update(payloadBase64)
    .digest("hex");

  const sigBuffer = Buffer.from(providedSig, "hex");
  const expectedBuffer = Buffer.from(expectedSig, "hex");

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const json = Buffer.from(payloadBase64, "base64url").toString("utf8");
    const payload = JSON.parse(json) as SessionPayload;

    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
