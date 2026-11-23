-- 0001_circuit_breaker.sql: Add endpoint status, health score, and circuit breaker columns

DO $$ BEGIN
  CREATE TYPE webhook_endpoint_status_enum AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS status webhook_endpoint_status_enum NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS health_score REAL NOT NULL DEFAULT 100.0,
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_reason TEXT;
