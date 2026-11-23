import { Worker, Job } from "bullmq";
import { pool, migrationPool } from "../db";
import { redis } from "../server/redis";
import { logger } from "../server/logger";
import { env } from "../server/env";
import {
  INGEST_QUEUE_NAME,
  IngestJobData,
  webhooksDeliverQueue,
  WebhookDeliverJobData,
} from "../server/queues";
import { matchesAnyPattern } from "../server/webhooks/matcher";
import { clickhouse } from "../server/analytics/clickhouse";
import { redisCircuitBreaker } from "../server/redis-circuit-breaker";

const BATCH_SIZE = env.INGEST_BATCH_SIZE || 100;
const FLUSH_INTERVAL_MS = 2000;

interface CachedEndpoint {
  id: string;
  url: string;
  subscribed_events: string[];
  signing_secret: string;
}

export class IngestBatchWorker {
  private buffer: IngestJobData[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private isShuttingDown = false;
  public worker: Worker<IngestJobData>;

  constructor(autoRegisterSignals = false) {
    this.worker = new Worker<IngestJobData>(
      INGEST_QUEUE_NAME,
      async (job: Job<IngestJobData>) => {
        await this.handleJob(job.data);
      },
      {
        connection: {
          url: env.REDIS_URL,
          maxRetriesPerRequest: null,
        },
        concurrency: 50,
      }
    );

    this.startFlushTimer();
    if (autoRegisterSignals) {
      this.registerSignalHandlers();
    }
  }

  public async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.worker.close();
  }

  private startFlushTimer() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(async () => {
      if (this.buffer.length > 0 && !this.isFlushing) {
        await this.flushBuffer();
      }
    }, FLUSH_INTERVAL_MS);
  }

  private async handleJob(data: IngestJobData) {
    this.buffer.push(data);
    if (this.buffer.length >= BATCH_SIZE && !this.isFlushing) {
      await this.flushBuffer();
    }
  }

  /**
   * Bulk inserts buffered events into PostgreSQL using a single multi-row INSERT query,
   * publishes frames to Redis Pub/Sub live channel, and fans out matching webhooks.
   */
  public async flushBuffer(): Promise<number> {
    if (this.buffer.length === 0 || this.isFlushing) return 0;
    this.isFlushing = true;

    // Drain buffer snapshot
    const batch = this.buffer.splice(0, this.buffer.length);
    const count = batch.length;
    const startTime = Date.now();

    try {
      // 1. Construct single parameterized multi-row INSERT INTO events
      const valuePlaceholders: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      for (const item of batch) {
        valuePlaceholders.push(
          `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7})`
        );
        values.push(
          item.id,
          item.orgId,
          item.eventName,
          item.idempotencyKey ?? null,
          JSON.stringify(item.payload),
          item.ingestLatencyMs,
          item.statusCode,
          item.createdAt
        );
        paramIdx += 8;
      }

      const sql = `
        INSERT INTO events (id, org_id, event_name, idempotency_key, payload, ingest_latency_ms, status_code, created_at)
        VALUES ${valuePlaceholders.join(", ")}
        ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
      `;

      // Use migrationPool/app_user client with system scope to insert batch
      await migrationPool.query(sql, values);

      const elapsed = Date.now() - startTime;
      logger.info(
        { count, elapsedMs: elapsed },
        `Flushed ${count} events to PostgreSQL in ${elapsed}ms`
      );

      // Replicate to ClickHouse analytics rollups if enabled
      if (clickhouse.isEnabled()) {
        clickhouse
          .insertEvents(
            batch.map((b) => ({
              orgId: b.orgId,
              eventName: b.eventName,
              statusCode: b.statusCode,
              latencyMs: b.ingestLatencyMs,
              createdAt: b.createdAt,
            }))
          )
          .catch(() => {});
      }

      // 2. Publish Live Tail frames to Redis channel live:{org_id} (protected by circuit breaker)
      await redisCircuitBreaker
        .execute(
          async () => {
            const pipeline = redis.pipeline();
            for (const item of batch) {
              const liveFrame = JSON.stringify({
                id: item.id,
                event: item.eventName,
                status: item.statusCode,
                latency_ms: item.ingestLatencyMs,
                org_id: item.orgId,
                timestamp: item.createdAt,
                method: "POST",
              });
              pipeline.publish(`live:{${item.orgId}}`, liveFrame);
            }
            await pipeline.exec();
          },
          () => {
            logger.warn("Skipping Live Tail frame publishing: Redis circuit breaker OPEN or unreachable");
          }
        )
        .catch(() => {});

      // 3. Webhook Fan-Out
      await this.fanOutWebhooks(batch);

      return count;
    } catch (err) {
      logger.error({ err, count }, "Batch flush failed; re-queuing events to buffer");
      // Put events back to front of buffer to prevent data loss
      this.buffer.unshift(...batch);
      throw err;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Fan-out: matches ingested events against active endpoints and enqueues to webhooks:deliver.
   */
  private async fanOutWebhooks(events: IngestJobData[]) {
    // Group events by orgId
    const eventsByOrg = new Map<string, IngestJobData[]>();
    for (const ev of events) {
      const list = eventsByOrg.get(ev.orgId) || [];
      list.push(ev);
      eventsByOrg.set(ev.orgId, list);
    }

    for (const [orgId, orgEvents] of eventsByOrg.entries()) {
      try {
        const endpoints = await this.getActiveEndpoints(orgId);
        if (endpoints.length === 0) continue;

        const webhookJobs: { name: string; data: WebhookDeliverJobData }[] = [];

        for (const ev of orgEvents) {
          for (const ep of endpoints) {
            if (matchesAnyPattern(ep.subscribed_events, ev.eventName)) {
              const deliveryId = `dlv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
              webhookJobs.push({
                name: "deliver",
                data: {
                  deliveryId,
                  orgId,
                  endpointId: ep.id,
                  endpointUrl: ep.url,
                  eventName: ev.eventName,
                  eventId: ev.id,
                  payload: ev.payload,
                  signingSecret: ep.signing_secret,
                  attemptNumber: 1,
                  maxAttempts: 5,
                  trigger: "auto",
                },
              });
            }
          }
        }

        if (webhookJobs.length > 0) {
          await webhooksDeliverQueue.addBulk(webhookJobs);
          logger.info(
            { orgId, jobCount: webhookJobs.length },
            `Fanned out ${webhookJobs.length} webhook deliveries`
          );
        }
      } catch (err) {
        logger.error({ err, orgId }, "Webhook fan-out error for org");
      }
    }
  }

  /**
   * Fetches active endpoints for an org, cached in Redis for 30s.
   */
  private async getActiveEndpoints(orgId: string): Promise<CachedEndpoint[]> {
    const cacheKey = `endpoints:active:{${orgId}}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Ignore cache read errors and query DB
    }

    const query = `
      SELECT id, url, subscribed_events, signing_secret
      FROM webhook_endpoints
      WHERE org_id = $1 AND is_active = true AND status = 'ACTIVE'
    `;
    const res = await migrationPool.query(query, [orgId]);
    const endpoints = res.rows as CachedEndpoint[];

    try {
      await redis.set(cacheKey, JSON.stringify(endpoints), "EX", 30);
    } catch {
      // Ignore cache write errors
    }

    return endpoints;
  }

  private registerSignalHandlers() {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      logger.info({ signal }, `Received ${signal}; starting graceful batch flusher shutdown...`);

      if (this.flushTimer) clearInterval(this.flushTimer);

      // 1. Pause BullMQ worker consumption
      await this.worker.pause();

      // 2. Await in-flight flushes and flush any remaining buffered events
      if (this.buffer.length > 0) {
        logger.info({ remaining: this.buffer.length }, "Flushing remaining buffered events before exit");
        await this.flushBuffer();
      }

      // 3. Close queues, pools, and redis cleanly
      await this.worker.close();
      if (!pool.ended) await pool.end();
      if (!migrationPool.ended) await migrationPool.end();
      redis.disconnect();

      logger.info("Graceful shutdown completed successfully with code 0");
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  }
}

import { fileURLToPath } from "url";
import path from "path";

// Standalone execution entrypoint
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  logger.info("Starting standalone BullMQ IngestBatchWorker process...");
  new IngestBatchWorker(true);
}

