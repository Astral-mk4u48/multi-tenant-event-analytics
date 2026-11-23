import { Worker, Job } from "bullmq";
import { pool, migrationPool } from "../db";
import { redis } from "../server/redis";
import { logger } from "../server/logger";
import { env } from "../server/env";
import { decryptSecret } from "../server/crypto";
import {
  WEBHOOKS_QUEUE_NAME,
  WebhookDeliverJobData,
  webhooksDeliverQueue,
} from "../server/queues";
import { sendOutboundWebhook } from "../server/webhooks/sender";

// Exponential Backoff Schedule per Section 4.4 of the specification:
// Attempt 1: 0s
// Attempt 2: 10s ±15%
// Attempt 3: 60s ±15%
// Attempt 4: 300s ±15%
// Attempt 5: 1800s ±15%
const BASE_DELAYS_MS: Record<number, number> = {
  2: 10 * 1000,
  3: 60 * 1000,
  4: 300 * 1000,
  5: 1800 * 1000,
};

export function calculateRetryDelay(nextAttempt: number): number | null {
  const base = BASE_DELAYS_MS[nextAttempt];
  if (!base) return null;

  // Apply ±15% jitter
  const jitterFactor = 1 + (Math.random() * 0.3 - 0.15);
  return Math.round(base * jitterFactor);
}

export class WebhookDeliveryWorker {
  public worker: Worker<WebhookDeliverJobData>;
  private isShuttingDown = false;

  constructor(autoRegisterSignals = false) {
    this.worker = new Worker<WebhookDeliverJobData>(
      WEBHOOKS_QUEUE_NAME,
      async (job: Job<WebhookDeliverJobData>) => {
        await this.handleJob(job.data);
      },
      {
        connection: {
          url: env.REDIS_URL,
          maxRetriesPerRequest: null,
        },
        concurrency: 25,
      }
    );

    if (autoRegisterSignals) {
      this.registerSignalHandlers();
    }
  }

  public async handleJob(job: WebhookDeliverJobData): Promise<void> {
    const {
      deliveryId,
      orgId,
      endpointUrl,
      eventName,
      eventId,
      payload,
      signingSecret,
      attemptNumber,
      maxAttempts,
      trigger,
    } = job;

    // Decrypt signing secret if stored encrypted
    let plainSecret = signingSecret;
    if (signingSecret.includes(":") && !signingSecret.startsWith("whsec_")) {
      try {
        plainSecret = decryptSecret(signingSecret);
      } catch (err) {
        logger.error({ err, deliveryId }, "Failed to decrypt webhook signing secret");
      }
    }

    const rawJsonBody = JSON.stringify(payload);

    // 1. Send Outbound Webhook with SSRF protection, HMAC signature, and 5s timeout
    const result = await sendOutboundWebhook({
      deliveryId,
      endpointUrl,
      rawJsonBody,
      signingSecret: plainSecret,
      timeoutMs: env.WEBHOOK_TIMEOUT_MS || 5000,
      allowLoopback: process.env.ALLOW_TEST_LOOPBACK === "true",
    });

    const isSuccess =
      result.statusCode !== null && result.statusCode >= 200 && result.statusCode < 300;

    let nextRetryDelayMs: number | null = null;
    let nextState: "DELIVERED" | "RETRYING" | "DLQ";

    if (isSuccess) {
      nextState = "DELIVERED";
    } else if (attemptNumber < maxAttempts) {
      nextState = "RETRYING";
      nextRetryDelayMs = calculateRetryDelay(attemptNumber + 1);
    } else {
      nextState = "DLQ";
    }

    // 2. Record delivery attempt in PostgreSQL
    const attemptId = `att_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    const attemptSql = `
      INSERT INTO webhook_attempts (
        id, org_id, delivery_id, attempt_number, trigger,
        status_code, is_timeout, latency_ms,
        request_headers, request_body, response_headers,
        response_body, response_truncated, next_retry_delay_ms, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    `;

    const attemptParams = [
      attemptId,
      orgId,
      deliveryId,
      attemptNumber,
      trigger,
      result.statusCode,
      result.isTimeout,
      result.latencyMs,
      JSON.stringify(result.requestHeaders),
      JSON.stringify(result.requestBody),
      JSON.stringify(result.responseHeaders),
      result.responseBody,
      result.responseTruncated,
      nextRetryDelayMs,
    ];

    // 3. Upsert / Update webhook_deliveries
    const nextRetryAt = nextRetryDelayMs ? new Date(Date.now() + nextRetryDelayMs) : null;

    const deliveryUpdateSql = `
      INSERT INTO webhook_deliveries (
        id, org_id, event_id, endpoint_id, event_name,
        endpoint_url, state, last_status_code, is_timeout,
        last_latency_ms, attempt_count, max_attempts, signature_prefix,
        next_retry_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      ON CONFLICT (id) DO UPDATE SET
        state = EXCLUDED.state,
        last_status_code = EXCLUDED.last_status_code,
        is_timeout = EXCLUDED.is_timeout,
        last_latency_ms = EXCLUDED.last_latency_ms,
        attempt_count = EXCLUDED.attempt_count,
        next_retry_at = EXCLUDED.next_retry_at,
        updated_at = NOW()
    `;

    const deliveryParams = [
      deliveryId,
      orgId,
      eventId || null,
      job.endpointId || null,
      eventName,
      endpointUrl,
      nextState,
      result.statusCode,
      result.isTimeout,
      result.latencyMs,
      attemptNumber,
      maxAttempts,
      result.signaturePrefix,
      nextRetryAt,
    ];

    try {
      await migrationPool.query("BEGIN");
      await migrationPool.query(deliveryUpdateSql, deliveryParams);
      await migrationPool.query(attemptSql, attemptParams);
      await migrationPool.query("COMMIT");
    } catch (err) {
      await migrationPool.query("ROLLBACK");
      logger.error({ err, deliveryId }, "Failed to log webhook attempt and delivery update");
      throw err;
    }

    // 4. Handle State Transitions
    if (nextState === "RETRYING" && nextRetryDelayMs !== null) {
      logger.info(
        { deliveryId, attemptNumber, nextAttempt: attemptNumber + 1, delayMs: nextRetryDelayMs },
        `Scheduling retry attempt ${attemptNumber + 1} in ${nextRetryDelayMs}ms`
      );

      const nextJob: WebhookDeliverJobData = {
        ...job,
        attemptNumber: attemptNumber + 1,
        trigger: "auto",
      };

      await webhooksDeliverQueue.add("deliver", nextJob, {
        delay: nextRetryDelayMs,
        jobId: `retry_${deliveryId}_${attemptNumber + 1}`,
      });
    } else if (nextState === "DLQ") {
      logger.warn(
        { deliveryId, orgId, attempts: attemptNumber },
        `Webhook delivery permanently failed after ${attemptNumber} attempts; moved to DLQ`
      );

      // Increment DLQ counter in Redis & publish to DLQ notification channel
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(`metrics:dlq:{${orgId}}`);
        pipeline.publish(
          `dlq:{${orgId}}`,
          JSON.stringify({
            deliveryId,
            orgId,
            eventName,
            endpointUrl,
            status: result.statusCode,
            isTimeout: result.isTimeout,
            attempts: attemptNumber,
            timestamp: new Date().toISOString(),
          })
        );
        await pipeline.exec();
      } catch (err) {
        logger.warn({ err, orgId }, "Failed to publish DLQ metric to Redis");
      }
    }
  }

  public async stop(): Promise<void> {
    await this.worker.close();
  }

  private registerSignalHandlers() {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      logger.info({ signal }, `Received ${signal}; shutting down WebhookDeliveryWorker...`);

      await this.worker.close();
      if (!pool.ended) await pool.end();
      if (!migrationPool.ended) await migrationPool.end();
      redis.disconnect();

      logger.info("WebhookDeliveryWorker shutdown complete with code 0");
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}

// Standalone execution entrypoint
if (require.main === module) {
  logger.info("Starting standalone BullMQ WebhookDeliveryWorker process...");
  new WebhookDeliveryWorker(true);
}
