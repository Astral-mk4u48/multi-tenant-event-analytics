import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  real,
  boolean,
  timestamp,
  jsonb,
  char,
  primaryKey,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Enums
export const roleEnum = pgEnum("role_enum", ["OWNER", "ADMIN", "VIEWER"]);
export const apiKeyScopeEnum = pgEnum("api_key_scope_enum", ["INGEST", "ADMIN"]);
export const webhookDeliveryStateEnum = pgEnum("webhook_delivery_state_enum", [
  "QUEUED",
  "DELIVERED",
  "RETRYING",
  "DLQ",
]);
export const webhookAttemptTriggerEnum = pgEnum("webhook_attempt_trigger_enum", [
  "auto",
  "manual",
]);

// 1. Organizations
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    rateLimitRpm: integer("rate_limit_rpm").notNull().default(6000),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("org_slug_idx").on(table.slug),
  ]
);

// 2. Users
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
  ]
);

// 3. Org Memberships
export const orgMemberships = pgTable(
  "org_memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    index("org_memberships_org_id_idx").on(table.orgId),
  ]
);

// 4. API Keys
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(), // e.g. 'key_01J9...'
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // first 12 visible chars, e.g. pk_live_8f2a
    keyHash: char("key_hash", { length: 64 }).notNull().unique(),
    scope: apiKeyScopeEnum("scope").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("api_keys_hash_idx").on(table.keyHash),
    index("api_keys_org_revoked_idx").on(table.orgId, table.revokedAt),
  ]
);

// 5. Events
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(), // 'evt_...'
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    idempotencyKey: text("idempotency_key"),
    payload: jsonb("payload").notNull(),
    ingestLatencyMs: real("ingest_latency_ms").notNull(),
    statusCode: smallint("status_code").notNull(), // 202 or 429
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("events_org_created_idx").on(table.orgId, sql`${table.createdAt} DESC`),
    index("events_org_name_created_idx").on(
      table.orgId,
      table.eventName,
      sql`${table.createdAt} DESC`
    ),
    uniqueIndex("events_org_idempotency_idx")
      .on(table.orgId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ]
);

// 6. Webhook Endpoints
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(), // 'ep_...'
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    subscribedEvents: text("subscribed_events").array().notNull(),
    signingSecret: text("signing_secret").notNull(), // AES-256-GCM encrypted
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("webhook_endpoints_org_active_idx").on(table.orgId, table.isActive),
  ]
);

// 7. Webhook Deliveries
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(), // 'dlv_...'
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: text("event_id").references(() => events.id),
    endpointId: text("endpoint_id").references(() => webhookEndpoints.id),
    eventName: text("event_name").notNull(),
    endpointUrl: text("endpoint_url").notNull(),
    state: webhookDeliveryStateEnum("state").notNull(),
    lastStatusCode: smallint("last_status_code"),
    isTimeout: boolean("is_timeout").notNull().default(false),
    lastLatencyMs: integer("last_latency_ms"),
    attemptCount: smallint("attempt_count").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull().default(5),
    signaturePrefix: text("signature_prefix").notNull(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("webhook_deliveries_org_state_created_idx").on(
      table.orgId,
      table.state,
      sql`${table.createdAt} DESC`
    ),
    index("webhook_deliveries_org_endpoint_created_idx").on(
      table.orgId,
      table.endpointId,
      sql`${table.createdAt} DESC`
    ),
  ]
);

// 8. Webhook Attempts
export const webhookAttempts = pgTable(
  "webhook_attempts",
  {
    id: text("id").primaryKey(), // 'att_...'
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: "cascade" }),
    attemptNumber: smallint("attempt_number").notNull(),
    trigger: webhookAttemptTriggerEnum("trigger").notNull(),
    statusCode: smallint("status_code"),
    isTimeout: boolean("is_timeout").notNull().default(false),
    latencyMs: integer("latency_ms").notNull(),
    requestHeaders: jsonb("request_headers").notNull(),
    requestBody: jsonb("request_body").notNull(),
    responseHeaders: jsonb("response_headers"),
    responseBody: text("response_body"), // capped 64 KB
    responseTruncated: boolean("response_truncated").notNull().default(false),
    nextRetryDelayMs: integer("next_retry_delay_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("webhook_attempts_delivery_attempt_idx").on(
      table.deliveryId,
      sql`${table.attemptNumber} DESC`
    ),
  ]
);
