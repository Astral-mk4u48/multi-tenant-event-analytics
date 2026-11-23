import { Queue } from "bullmq";
import { env } from "../env";

export interface IngestJobData {
  id: string; // evt_...
  orgId: string;
  eventName: string;
  idempotencyKey?: string | null;
  payload: Record<string, unknown>;
  ingestLatencyMs: number;
  statusCode: number; // 202
  createdAt: string; // ISO string
}

export interface WebhookDeliverJobData {
  deliveryId: string; // dlv_...
  orgId: string;
  endpointId: string;
  endpointUrl: string;
  eventName: string;
  eventId: string;
  payload: Record<string, unknown>;
  signingSecret: string;
  attemptNumber: number;
  maxAttempts: number;
  trigger: "auto" | "manual";
}

const redisConnection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
};

export const INGEST_QUEUE_NAME = "events_ingest";
export const WEBHOOKS_QUEUE_NAME = "webhooks_deliver";

export const eventsIngestQueue = new Queue<IngestJobData>(INGEST_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 500,
    },
  },
});

export const webhooksDeliverQueue = new Queue<WebhookDeliverJobData>(
  WEBHOOKS_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 5000,
    },
  }
);
