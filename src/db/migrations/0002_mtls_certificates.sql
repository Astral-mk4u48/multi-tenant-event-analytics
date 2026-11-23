-- 0002_mtls_certificates.sql: Add enterprise mTLS client certificate support

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS mtls_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tls_client_cert TEXT,
  ADD COLUMN IF NOT EXISTS tls_client_key TEXT,
  ADD COLUMN IF NOT EXISTS tls_ca_cert TEXT;
