-- 0000_init.sql: PostgreSQL schema, indexes, RLS policies, and triggers

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
DO $$ BEGIN
  CREATE TYPE role_enum AS ENUM ('OWNER', 'ADMIN', 'VIEWER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE api_key_scope_enum AS ENUM ('INGEST', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE webhook_delivery_state_enum AS ENUM ('QUEUED', 'DELIVERED', 'RETRYING', 'DLQ');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE webhook_attempt_trigger_enum AS ENUM ('auto', 'manual');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  rate_limit_rpm INT NOT NULL DEFAULT 6000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_slug_idx ON organizations (slug);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- 3. Org Memberships
CREATE TABLE IF NOT EXISTS org_memberships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role role_enum NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_memberships_org_id_idx ON org_memberships (org_id);

-- 4. API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash CHAR(64) NOT NULL UNIQUE,
  scope api_key_scope_enum NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_org_revoked_idx ON api_keys (org_id, revoked_at);

-- 5. Events
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  idempotency_key TEXT,
  payload JSONB NOT NULL,
  ingest_latency_ms REAL NOT NULL,
  status_code SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_org_created_idx ON events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_org_name_created_idx ON events (org_id, event_name, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS events_org_idempotency_idx ON events (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 6. Webhook Endpoints
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  subscribed_events TEXT[] NOT NULL,
  signing_secret TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_endpoints_org_active_idx ON webhook_endpoints (org_id, is_active);

-- 7. Webhook Deliveries
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES events(id),
  endpoint_id TEXT REFERENCES webhook_endpoints(id),
  event_name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  state webhook_delivery_state_enum NOT NULL,
  last_status_code SMALLINT,
  is_timeout BOOLEAN NOT NULL DEFAULT false,
  last_latency_ms INT,
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  max_attempts SMALLINT NOT NULL DEFAULT 5,
  signature_prefix TEXT NOT NULL,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_org_state_created_idx ON webhook_deliveries (org_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_org_endpoint_created_idx ON webhook_deliveries (org_id, endpoint_id, created_at DESC);

-- 8. Webhook Attempts
CREATE TABLE IF NOT EXISTS webhook_attempts (
  id TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  attempt_number SMALLINT NOT NULL,
  trigger webhook_attempt_trigger_enum NOT NULL,
  status_code SMALLINT,
  is_timeout BOOLEAN NOT NULL DEFAULT false,
  latency_ms INT NOT NULL,
  request_headers JSONB NOT NULL,
  request_body JSONB NOT NULL,
  response_headers JSONB,
  response_body TEXT,
  response_truncated BOOLEAN NOT NULL DEFAULT false,
  next_retry_delay_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_attempts_delivery_attempt_idx ON webhook_attempts (delivery_id, attempt_number DESC);

-- Trigger: prevent demoting or deleting the final OWNER of an organization
CREATE OR REPLACE FUNCTION prevent_last_owner_removal()
RETURNS TRIGGER AS $$
DECLARE
  owner_count INT;
  org_exists BOOLEAN;
BEGIN
  -- If the organization itself is being deleted, allow cascade delete
  SELECT EXISTS(SELECT 1 FROM organizations WHERE id = OLD.org_id) INTO org_exists;
  IF NOT org_exists THEN
    RETURN OLD;
  END IF;

  IF (TG_OP = 'DELETE' AND OLD.role = 'OWNER') OR 
     (TG_OP = 'UPDATE' AND OLD.role = 'OWNER' AND NEW.role <> 'OWNER') THEN
    SELECT COUNT(*) INTO owner_count
    FROM org_memberships
    WHERE org_id = OLD.org_id AND role = 'OWNER' AND user_id <> OLD.user_id;

    IF owner_count = 0 THEN
      RAISE EXCEPTION 'Cannot demote or delete the final OWNER of an organization';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_last_owner_removal ON org_memberships;
CREATE TRIGGER trg_prevent_last_owner_removal
BEFORE UPDATE OR DELETE ON org_memberships
FOR EACH ROW
EXECUTE FUNCTION prevent_last_owner_removal();

-- Grant permissions to non-superuser app_user
GRANT USAGE ON SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;

-- Row Level Security (RLS) enforcement
-- Enable and force RLS on all tenant-owned tables
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_events ON events;
CREATE POLICY tenant_isolation_events ON events
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_api_keys ON api_keys;
CREATE POLICY tenant_isolation_api_keys ON api_keys
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_webhook_endpoints ON webhook_endpoints;
CREATE POLICY tenant_isolation_webhook_endpoints ON webhook_endpoints
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_webhook_deliveries ON webhook_deliveries;
CREATE POLICY tenant_isolation_webhook_deliveries ON webhook_deliveries
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE webhook_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_webhook_attempts ON webhook_attempts;
CREATE POLICY tenant_isolation_webhook_attempts ON webhook_attempts
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_org_memberships ON org_memberships;
CREATE POLICY tenant_isolation_org_memberships ON org_memberships
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
