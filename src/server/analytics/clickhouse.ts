import { logger } from "../logger";

export interface ClickhouseEventItem {
  orgId: string;
  eventName: string;
  statusCode: number;
  latencyMs: number;
  createdAt: string;
}

export interface ClickhouseRollupResult {
  range: string;
  updated_at_utc: string;
  source: "clickhouse";
  kpis: {
    eventsIngested: {
      value: number;
      deltaPercent: number;
      deltaLabel: string;
    };
    p99LatencyMs: {
      value: number;
      deltaMs: number;
      deltaLabel: string;
    };
  };
  volumeSeries: Array<{
    bucket: string;
    ingested: number;
    rateLimited: number;
  }>;
  topEventTypes: Array<{
    name: string;
    count: number;
    percent: number;
  }>;
}

export class ClickhouseAnalyticsClient {
  private url: string;
  private user: string;
  private password?: string;
  private database: string;
  private enabled: boolean;

  constructor() {
    this.url = process.env.CLICKHOUSE_URL || "http://localhost:8123";
    this.user = process.env.CLICKHOUSE_USER || "default";
    this.password = process.env.CLICKHOUSE_PASSWORD || undefined;
    this.database = process.env.CLICKHOUSE_DATABASE || "default";
    this.enabled = process.env.CLICKHOUSE_ENABLED === "true";
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public setUrl(url: string): void {
    this.url = url;
  }

  /**
   * Health ping against ClickHouse HTTP interface with 1000ms timeout.
   */
  public async checkHealth(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const pingUrl = `${this.url.replace(/\/+$/, "")}/ping`;
      const res = await fetch(pingUrl, {
        method: "GET",
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Initializes high-velocity analytics table in ClickHouse if not exists.
   */
  public async initSchema(): Promise<boolean> {
    if (!this.enabled) return false;
    const createSql = `
      CREATE TABLE IF NOT EXISTS ${this.database}.event_analytics_rollup (
        org_id UUID,
        event_name LowCardinality(String),
        status_code UInt16,
        latency_ms Float32,
        created_at DateTime64(3, 'UTC')
      ) ENGINE = MergeTree()
      PARTITION BY toYYYYMM(created_at)
      ORDER BY (org_id, event_name, status_code, created_at)
      TTL created_at + INTERVAL 90 DAY;
    `;

    try {
      const res = await this.execute(createSql);
      return res !== null;
    } catch (err) {
      logger.warn({ err }, "ClickHouse schema initialization skipped");
      return false;
    }
  }

  /**
   * High-velocity event dual-write into ClickHouse.
   * Inserts row batch formatted as JSONEachRow.
   */
  public async insertEvents(events: ClickhouseEventItem[]): Promise<number> {
    if (!this.enabled || events.length === 0) return 0;

    try {
      const payload = events
        .map((e) =>
          JSON.stringify({
            org_id: e.orgId,
            event_name: e.eventName,
            status_code: e.statusCode,
            latency_ms: e.latencyMs,
            created_at: new Date(e.createdAt).toISOString().replace("T", " ").replace("Z", ""),
          })
        )
        .join("\n");

      const queryUrl = `${this.url.replace(/\/+$/, "")}/?database=${encodeURIComponent(
        this.database
      )}&query=${encodeURIComponent("INSERT INTO event_analytics_rollup FORMAT JSONEachRow")}`;

      const res = await fetch(queryUrl, {
        method: "POST",
        headers: this.getHeaders({ "Content-Type": "application/x-ndjson" }),
        body: payload,
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.warn({ status: res.status, text }, "ClickHouse insert batch failed");
        return 0;
      }

      return events.length;
    } catch (err) {
      logger.warn({ err }, "ClickHouse insertEvents failed; primary ingestion unaffected");
      return 0;
    }
  }

  /**
   * Queries time-bucketed event rollups from ClickHouse for enterprise sub-second analytics.
   * Returns null if ClickHouse is not available or query fails, triggering PostgreSQL fallback.
   */
  public async queryRollups(
    orgId: string,
    range: "1h" | "24h" | "7d" | "30d" = "24h"
  ): Promise<ClickhouseRollupResult | null> {
    if (!this.enabled) return null;

    const intervalMinutes = range === "1h" ? 60 : range === "24h" ? 1440 : range === "7d" ? 10080 : 43200;
    const bucketStep = range === "1h" ? "toStartOfMinute" : range === "30d" ? "toStartOfDay" : "toStartOfHour";

    try {
      // 1. KPI Query: Ingested count & p99 latency
      const kpiSql = `
        SELECT
          countIf(status_code = 202) AS current_ingested,
          quantile(0.99)(latency_ms) AS current_p99
        FROM ${this.database}.event_analytics_rollup
        WHERE org_id = '${orgId}'
          AND created_at >= now() - INTERVAL ${intervalMinutes} MINUTE
        FORMAT JSON;
      `;

      // 2. Volume Series: Ingested vs 429 rate-limited per bucket
      const volumeSql = `
        SELECT
          ${bucketStep}(created_at) AS bucket,
          countIf(status_code = 202) AS ingested,
          countIf(status_code = 429) AS rate_limited
        FROM ${this.database}.event_analytics_rollup
        WHERE org_id = '${orgId}'
          AND created_at >= now() - INTERVAL ${intervalMinutes} MINUTE
        GROUP BY bucket
        ORDER BY bucket ASC
        FORMAT JSON;
      `;

      // 3. Top Event Types Breakdown
      const topSql = `
        SELECT
          event_name AS name,
          count() AS count
        FROM ${this.database}.event_analytics_rollup
        WHERE org_id = '${orgId}'
          AND created_at >= now() - INTERVAL ${intervalMinutes} MINUTE
        GROUP BY event_name
        ORDER BY count DESC
        LIMIT 6
        FORMAT JSON;
      `;

      const [kpiRes, volumeRes, topRes] = await Promise.all([
        this.query<{ current_ingested: string | number; current_p99: string | number }>(kpiSql),
        this.query<{ bucket: string; ingested: string | number; rate_limited: string | number }>(volumeSql),
        this.query<{ name: string; count: string | number }>(topSql),
      ]);

      if (!kpiRes || !volumeRes || !topRes) {
        return null;
      }

      const kpiRow = kpiRes[0] || { current_ingested: 0, current_p99: 0 };
      const ingestedCount = Number(kpiRow.current_ingested) || 0;
      const p99 = Math.round((Number(kpiRow.current_p99) || 0) * 10) / 10;

      const series = volumeRes.map((r) => ({
        bucket: new Date(r.bucket).toISOString(),
        ingested: Number(r.ingested) || 0,
        rateLimited: Number(r.rate_limited) || 0,
      }));

      const totalTop = topRes.reduce((acc, t) => acc + (Number(t.count) || 0), 0);
      const topEventTypes = topRes.map((t) => {
        const count = Number(t.count) || 0;
        const percent = totalTop > 0 ? Math.round((count / totalTop) * 1000) / 10 : 0;
        return { name: t.name, count, percent };
      });

      return {
        range,
        updated_at_utc: new Date().toISOString(),
        source: "clickhouse",
        kpis: {
          eventsIngested: {
            value: ingestedCount,
            deltaPercent: 0,
            deltaLabel: `+0% vs prev ${range}`,
          },
          p99LatencyMs: {
            value: p99,
            deltaMs: 0,
            deltaLabel: `+0ms vs prev ${range}`,
          },
        },
        volumeSeries: series,
        topEventTypes,
      };
    } catch (err) {
      logger.warn({ err, orgId }, "ClickHouse analytics query failed; falling back to PostgreSQL");
      return null;
    }
  }

  private async execute(sql: string): Promise<string | null> {
    try {
      const queryUrl = `${this.url.replace(/\/+$/, "")}/?database=${encodeURIComponent(this.database)}`;
      const res = await fetch(queryUrl, {
        method: "POST",
        headers: this.getHeaders({ "Content-Type": "text/plain" }),
        body: sql,
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  private async query<T>(sql: string): Promise<T[] | null> {
    try {
      const queryUrl = `${this.url.replace(/\/+$/, "")}/?database=${encodeURIComponent(this.database)}`;
      const res = await fetch(queryUrl, {
        method: "POST",
        headers: this.getHeaders({ "Content-Type": "text/plain" }),
        body: sql,
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (json.data as T[]) || [];
    } catch {
      return null;
    }
  }

  private getHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.user) headers["X-ClickHouse-User"] = this.user;
    if (this.password) headers["X-ClickHouse-Key"] = this.password;
    return headers;
  }
}

export const clickhouse = new ClickhouseAnalyticsClient();
