-- Migration: 0003_rls_nullif_safety.sql
-- Guard RLS policies with NULLIF(..., '') so queries without tenant context evaluate cleanly to NULL (returning zero rows) instead of throwing uuid cast errors.

DROP POLICY IF EXISTS tenant_isolation_events ON events;
CREATE POLICY tenant_isolation_events ON events
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_api_keys ON api_keys;
CREATE POLICY tenant_isolation_api_keys ON api_keys
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_webhook_endpoints ON webhook_endpoints;
CREATE POLICY tenant_isolation_webhook_endpoints ON webhook_endpoints
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_webhook_deliveries ON webhook_deliveries;
CREATE POLICY tenant_isolation_webhook_deliveries ON webhook_deliveries
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_webhook_attempts ON webhook_attempts;
CREATE POLICY tenant_isolation_webhook_attempts ON webhook_attempts
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_org_memberships ON org_memberships;
CREATE POLICY tenant_isolation_org_memberships ON org_memberships
  USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
