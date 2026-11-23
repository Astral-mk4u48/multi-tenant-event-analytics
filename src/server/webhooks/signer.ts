import crypto from "crypto";

export interface WebhookSignatureResult {
  signature: string;
  timestamp: number;
  signatureHeader: string;
  signaturePrefix: string;
}

/**
 * Signs an outbound webhook payload using HMAC-SHA256 per Section 4.2 of the spec.
 *
 * Headers produced:
 * X-Webhook-Id: dlv_01J9XK3M7Q8N2
 * X-Webhook-Timestamp: 1795461242
 * X-Webhook-Signature: t=1795461242,v1=<hex(HMAC_SHA256(signing_secret, "1795461242." + raw_json_body))>
 */
export function signWebhookPayload(
  signingSecret: string,
  rawJsonBody: string,
  timestamp?: number
): WebhookSignatureResult {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const payloadToSign = `${ts}.${rawJsonBody}`;

  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(payloadToSign)
    .digest("hex");

  const signatureHeader = `t=${ts},v1=${hmac}`;
  const signaturePrefix = `sha256=${hmac.slice(0, 10)}...`;

  return {
    signature: hmac,
    timestamp: ts,
    signatureHeader,
    signaturePrefix,
  };
}

/**
 * Cryptographically verifies an incoming webhook signature using HMAC-SHA256
 * and constant-time comparison to prevent timing attacks.
 */
export function verifyWebhookSignature(
  signingSecret: string,
  rawJsonBody: string,
  signatureHeader: string,
  toleranceSeconds = 300 // 5-minute freshness tolerance
): boolean {
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(",");
  let timestampStr: string | null = null;
  let receivedSignature: string | null = null;

  for (const part of parts) {
    const [key, val] = part.split("=");
    if (key === "t") timestampStr = val;
    if (key === "v1") receivedSignature = val;
  }

  if (!timestampStr || !receivedSignature) return false;

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Freshness check: reject requests older than tolerance window
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  // Recompute HMAC
  const expectedHmac = crypto
    .createHmac("sha256", signingSecret)
    .update(`${timestamp}.${rawJsonBody}`)
    .digest("hex");

  const sigBuffer = Buffer.from(receivedSignature, "hex");
  const expectedBuffer = Buffer.from(expectedHmac, "hex");

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}
