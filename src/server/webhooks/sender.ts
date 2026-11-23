import http from "http";
import https from "https";
import { validateOutboundUrl, ssrfSafeHttpAgent, ssrfSafeHttpsAgent, SSRFBlockedError } from "./ssrf";
import { signWebhookPayload } from "./signer";
import { logger } from "../logger";

export interface OutboundDeliveryParams {
  deliveryId: string;
  endpointUrl: string;
  rawJsonBody: string;
  signingSecret: string;
  timeoutMs?: number;
  allowLoopback?: boolean;
}

export interface OutboundDeliveryResult {
  statusCode: number | null;
  isTimeout: boolean;
  latencyMs: number;
  requestHeaders: Record<string, string>;
  requestBody: Record<string, unknown>;
  responseHeaders: Record<string, string>;
  responseBody: string;
  responseTruncated: boolean;
  signaturePrefix: string;
  error?: string;
}

const MAX_RESPONSE_BYTES = 64 * 1024; // 64 KB response body cap

/**
 * Sends an outbound webhook POST with SSRF defense, HMAC signing,
 * 5,000ms timeout, manual redirect handling, and 64KB response truncation.
 */
export async function sendOutboundWebhook(
  params: OutboundDeliveryParams
): Promise<OutboundDeliveryResult> {
  const startTime = Date.now();
  const timeoutMs = params.timeoutMs ?? 5000;
  const allowLoopback = params.allowLoopback ?? false;

  // 1. SSRF Pre-validation
  try {
    await validateOutboundUrl(params.endpointUrl, allowLoopback);
  } catch (err) {
    const errorMsg = err instanceof SSRFBlockedError ? err.message : "SSRF validation failed";
    logger.warn({ err, url: params.endpointUrl }, "Outbound webhook SSRF blocked");
    return {
      statusCode: null,
      isTimeout: false,
      latencyMs: Date.now() - startTime,
      requestHeaders: {},
      requestBody: tryParseJson(params.rawJsonBody),
      responseHeaders: {},
      responseBody: errorMsg,
      responseTruncated: false,
      signaturePrefix: "none",
      error: errorMsg,
    };
  }

  // 2. Sign Payload (HMAC-SHA256)
  const signResult = signWebhookPayload(params.signingSecret, params.rawJsonBody);

  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Astral-Webhook-Delivery/1.0",
    "x-webhook-id": params.deliveryId,
    "x-webhook-timestamp": signResult.timestamp.toString(),
    "x-webhook-signature": signResult.signatureHeader,
  };

  const parsedUrl = new URL(params.endpointUrl);
  const isHttps = parsedUrl.protocol === "https:";
  const agent = allowLoopback
    ? undefined
    : isHttps
    ? ssrfSafeHttpsAgent
    : ssrfSafeHttpAgent;
  const transport = isHttps ? https : http;

  return new Promise((resolve) => {
    let isTimeout = false;
    let timer: NodeJS.Timeout | null = null;

    const requestOptions: http.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "POST",
      headers: {
        ...requestHeaders,
        "content-length": Buffer.byteLength(params.rawJsonBody, "utf8"),
      },
      agent,
    };

    const req = transport.request(requestOptions, (res) => {
      if (timer) clearTimeout(timer);

      const latencyMs = Date.now() - startTime;
      const responseHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === "string") responseHeaders[k] = v;
        else if (Array.isArray(v)) responseHeaders[k] = v.join(", ");
      }

      // Check redirects (3xx) - redirect: "manual" per spec
      const statusCode = res.statusCode ?? 500;
      if (statusCode >= 300 && statusCode < 400) {
        res.resume(); // discard
        return resolve({
          statusCode,
          isTimeout: false,
          latencyMs,
          requestHeaders,
          requestBody: tryParseJson(params.rawJsonBody),
          responseHeaders,
          responseBody: `Redirect ${statusCode} blocked per SSRF defense policy`,
          responseTruncated: false,
          signaturePrefix: signResult.signaturePrefix,
        });
      }

      // Stream read with 64 KB cap
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let responseTruncated = false;

      res.on("data", (chunk: Buffer) => {
        if (totalBytes + chunk.length > MAX_RESPONSE_BYTES) {
          const allowed = MAX_RESPONSE_BYTES - totalBytes;
          if (allowed > 0) chunks.push(chunk.subarray(0, allowed));
          totalBytes = MAX_RESPONSE_BYTES;
          responseTruncated = true;
          res.destroy(); // discard remainder
        } else {
          chunks.push(chunk);
          totalBytes += chunk.length;
        }
      });

      res.on("end", () => {
        const fullBody = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode,
          isTimeout: false,
          latencyMs,
          requestHeaders,
          requestBody: tryParseJson(params.rawJsonBody),
          responseHeaders,
          responseBody: fullBody,
          responseTruncated,
          signaturePrefix: signResult.signaturePrefix,
        });
      });

      res.on("close", () => {
        const fullBody = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode,
          isTimeout: false,
          latencyMs,
          requestHeaders,
          requestBody: tryParseJson(params.rawJsonBody),
          responseHeaders,
          responseBody: fullBody,
          responseTruncated,
          signaturePrefix: signResult.signaturePrefix,
        });
      });
    });

    // Enforce 5,000ms timeout
    timer = setTimeout(() => {
      isTimeout = true;
      req.destroy(new Error("Request timed out after 5,000ms"));
    }, timeoutMs);

    req.on("error", (err) => {
      if (timer) clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      const isSSRF = err instanceof SSRFBlockedError || err.message.includes("SSRF Blocked");

      resolve({
        statusCode: null,
        isTimeout,
        latencyMs,
        requestHeaders,
        requestBody: tryParseJson(params.rawJsonBody),
        responseHeaders: {},
        responseBody: isTimeout ? "Request timed out (TIMEOUT)" : err.message,
        responseTruncated: false,
        signaturePrefix: signResult.signaturePrefix,
        error: isSSRF ? "SSRF Blocked" : err.message,
      });
    });

    // Send payload
    req.write(params.rawJsonBody);
    req.end();
  });
}

function tryParseJson(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}
