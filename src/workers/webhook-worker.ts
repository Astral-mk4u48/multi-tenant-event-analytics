import { Worker, Job } from "bullmq";
import { redis } from "../server/redis";
import { migrationPool } from "../db";
import { logger } from "../server/logger";
import { env } from "../server/env";
import { sendOutboundWebhook } from "../server/webhooks/sender";
import { decryptSecret } from "../server/crypto";
import { webhooksDeliverQueue, WebhookDeliverJobData } from "../server/queues";
import { fileURLToPath } from "url";
import path from "path";

export type { WebhookDeliverJobData };

/**
 * 5-step exponential backoff schedule: 0s, 10s, 60s, 300s, 1800s ±15% jitter
 */
export function calculateRetryDelay(attemptNumber: number): number | null {
  if (attemptNumber > 5 || attemptNumber < 1) return null;
  const baseDelaysMs = [0, 10000, 60000, 300000, 1800000];
  const base = baseDelaysMs[attemptNumber - 1];

  if (base === 0) return 0;

  // Apply ±15% jitter
  const jitterRange = base * 0.15;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.round(base + jitter);
}

/**
 * Updates sliding-window health score and trips circuit breaker after 5 consecutive 5xx/timeout failures.
 */
export async function updateEndpointHealthAndCircuitBreaker(
  endpointId: string,
  orgId: string,
  result: { statusCode: number | null; isTimeout: boolean }
): Promise<{ status: "ACTIVE" | "PAUSED" | "DISABLED"; healthScore: number; consecutiveFailures: number }> {
  const is5xxOrTimeout = result.isTimeout || (result.statusCode !== null && result.statusCode >= 500);
  const is2xx = result.statusCode !== null && result.statusCode >= 200 && result.statusCode < 300;

  // 1. Fetch current endpoint status
  const curRes = await migrationPool.query(
    "SELECT status, consecutive_failures, health_score FROM webhook_endpoints WHERE id = $1",
    [endpointId]
  );
  if (curRes.rows.length === 0) {
    return { status: "ACTIVE", healthScore: 100, consecutiveFailures: 0 };
  }

  const current = curRes.rows[0];
  let consecutiveFailures = current.consecutive_failures || 0;
  let status: "ACTIVE" | "PAUSED" | "DISABLED" = current.status || "ACTIVE";
  let pausedAt: Date | null = null;
  let pausedReason: string | null = null;

  if (is2xx) {
    consecutiveFailures = 0;
  } else if (is5xxOrTimeout) {
    consecutiveFailures += 1;
  }

  // 2. Compute sliding-window health score over the last 20 deliveries
  const scoreRes = await migrationPool.query(
    `SELECT
       COUNT(*)::int as total,
       COUNT(*) FILTER (WHERE state = 'DELIVERED')::int as successful
     FROM (
       SELECT state FROM webhook_deliveries
       WHERE endpoint_id = $1
       ORDER BY updated_at DESC
       LIMIT 20
     ) sub`,
    [endpointId]
  );

  const total = scoreRes.rows[0]?.total || 0;
  const successful = scoreRes.rows[0]?.successful || 0;
  const healthScore =
    total > 0
      ? Math.round((successful / total) * 1000) / 10
      : is2xx
      ? 100.0
      : is5xxOrTimeout
      ? 0.0
      : 50.0;

  // 3. Trip Circuit Breaker after 5 consecutive failures
  if (consecutiveFailures >= 5 && status !== "PAUSED" && status !== "DISABLED") {
    status = "PAUSED";
    pausedAt = new Date();
    pausedReason = `Auto-paused: Circuit breaker tripped after ${consecutiveFailures} consecutive delivery failures (5xx/timeout).`;
    logger.warn({ endpointId, orgId, consecutiveFailures }, "Circuit breaker tripped: endpoint auto-paused");

    try {
      await redis.del(`endpoints:active:{${orgId}}`);
    } catch {
      // Ignore cache invalidation error
    }
  }

  // 4. Persist updated health metrics
  if (status === "PAUSED" && pausedAt) {
    await migrationPool.query(
      `UPDATE webhook_endpoints
       SET status = $1,
           consecutive_failures = $2,
           health_score = $3,
           paused_at = $4,
           paused_reason = $5
       WHERE id = $6`,
      [status, consecutiveFailures, healthScore, pausedAt, pausedReason, endpointId]
    );
  } else {
    await migrationPool.query(
      `UPDATE webhook_endpoints
       SET consecutive_failures = $1,
           health_score = $2
       WHERE id = $3`,
      [consecutiveFailures, healthScore, endpointId]
    );
  }

  return { status, healthScore, consecutiveFailures };
}

export class WebhookDeliveryWorker {
  private worker: Worker;

  constructor(autoRegisterSignals = true) {
    this.worker = new Worker<WebhookDeliverJobData>(
      "webhooks_deliver",
      async (job: Job<WebhookDeliverJobData>) => {
        await this.handleJob(job.data);
      },
      {
        connection: redis,
        concurrency: 10,
      }
    );

    this.worker.on("failed", (job, err) => {
      logger.error({ err, jobId: job?.id }, "Webhook delivery job processing failed");
    });

    if (autoRegisterSignals) {
      this.registerSignalHandlers();
    }
  }

  public async handleJob(job: WebhookDeliverJobData): Promise<void> {
    const {
      deliveryId,
      orgId,
      endpointId,
      endpointUrl,
      eventName,
      eventId,
      payload,
      signingSecret,
      attemptNumber,
      maxAttempts,
      trigger,
    } = job;

    // 0. Circuit Breaker Gate: If endpoint is paused or disabled, abort delivery
    if (endpointId) {
      const epCheck = await migrationPool.query(
        "SELECT status, paused_reason FROM webhook_endpoints WHERE id = $1",
        [endpointId]
      );
      if (epCheck.rows.length > 0) {
        const ep = epCheck.rows[0];
        if (ep.status === "PAUSED" || ep.status === "DISABLED") {
          logger.warn(
            { deliveryId, endpointId, status: ep.status },
            `Skipping webhook delivery: endpoint is ${ep.status}`
          );

          await migrationPool.query(
            `UPDATE webhook_deliveries
             SET state = 'DLQ',
                 updated_at = NOW()
             WHERE id = $1`,
            [deliveryId]
          );
          return;
        }
      }
    }

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
      endpointId || null,
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

    // 4. Update endpoint health score and check circuit breaker
    if (endpointId) {
      try {
        await updateEndpointHealthAndCircuitBreaker(endpointId, orgId, {
          statusCode: result.statusCode,
          isTimeout: result.isTimeout,
        });
      } catch (err) {
        logger.error({ err, endpointId }, "Failed to update endpoint health and circuit breaker");
      }
    }

    // 5. Handle State Transitions
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
            error: result.error || `HTTP ${result.statusCode}`,
          })
        );
        await pipeline.exec();
      } catch (err) {
        logger.error({ err, deliveryId }, "Failed to update DLQ metrics");
      }
    }
  }

  public async close(): Promise<void> {
    await this.worker.close();
  }

  public async stop(): Promise<void> {
    await this.close();
  }

  private registerSignalHandlers() {
    const shutdown = async (signal: string) => {
      logger.info({ signal }, `Received ${signal}; shutting down WebhookDeliveryWorker...`);
      await this.worker.close();
      if (!migrationPool.ended) {
        await migrationPool.end();
      }
      logger.info("WebhookDeliveryWorker shutdown complete with code 0");
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}

// Standalone execution entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  logger.info("Starting standalone BullMQ WebhookDeliveryWorker process...");
  new WebhookDeliveryWorker(true);
}
