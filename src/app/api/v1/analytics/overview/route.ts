import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/server/auth/guard";
import { migrationPool } from "@/db";
import { logger } from "@/server/logger";
import { clickhouse } from "@/server/analytics/clickhouse";

export const dynamic = "force-dynamic";

interface RangeConfig {
  interval: string;
  priorInterval: string;
  bucketTrunc: "minute" | "hour" | "day";
  dateTruncInterval?: string;
}

const RANGES: Record<string, RangeConfig> = {
  "1h": {
    interval: "1 hour",
    priorInterval: "2 hours",
    bucketTrunc: "minute",
  },
  "24h": {
    interval: "24 hours",
    priorInterval: "48 hours",
    bucketTrunc: "hour",
  },
  "7d": {
    interval: "7 days",
    priorInterval: "14 days",
    bucketTrunc: "hour",
  },
  "30d": {
    interval: "30 days",
    priorInterval: "60 days",
    bucketTrunc: "day",
  },
};

/**
 * GET /api/v1/analytics/overview?range=1h|24h|7d|30d
 * Returns 4 KPI metrics with deltas, time-series volume buckets, and Top Event Types.
 */
export async function GET(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rangeParam = searchParams.get("range") || "24h";
  const config = RANGES[rangeParam] || RANGES["24h"];

  try {
    const client = await migrationPool.connect();
    try {
      // 0. Check ClickHouse High-Velocity Analytics Rollup Path
      const chRollup = clickhouse.isEnabled()
        ? await clickhouse.queryRollups(auth.orgId, rangeParam as "1h" | "24h" | "7d" | "30d")
        : null;

      // 1. Current & Previous KPIs: Ingestion, Rate Limits, and p99 Latency
      let kpiData = {
        current_ingested: 0,
        prev_ingested: 0,
        current_p99: 0,
        prev_p99: 0,
      };

      if (chRollup) {
        kpiData = {
          current_ingested: chRollup.kpis.eventsIngested.value,
          prev_ingested: 0,
          current_p99: chRollup.kpis.p99LatencyMs.value,
          prev_p99: 0,
        };
      } else {
        const kpiQuery = `
          SELECT
            COUNT(*) FILTER (WHERE status_code = 202 AND created_at >= NOW() - $2::interval)::int AS current_ingested,
            COUNT(*) FILTER (WHERE status_code = 202 AND created_at < NOW() - $2::interval AND created_at >= NOW() - $3::interval)::int AS prev_ingested,
            ROUND(COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY ingest_latency_ms) FILTER (WHERE created_at >= NOW() - $2::interval), 0)::numeric, 1) AS current_p99,
            ROUND(COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY ingest_latency_ms) FILTER (WHERE created_at < NOW() - $2::interval AND created_at >= NOW() - $3::interval), 0)::numeric, 1) AS prev_p99
          FROM events
          WHERE org_id = $1 AND created_at >= NOW() - $3::interval;
        `;
        const kpiRes = await client.query(kpiQuery, [auth.orgId, config.interval, config.priorInterval]);
        kpiData = kpiRes.rows[0] || kpiData;
      }

      // 2. Delivery Success Rate & DLQ Counts
      const deliveryQuery = `
        SELECT
          COUNT(*) FILTER (WHERE state = 'DELIVERED' AND created_at >= NOW() - $2::interval)::int AS current_delivered,
          COUNT(*) FILTER (WHERE created_at >= NOW() - $2::interval)::int AS current_total_deliveries,
          COUNT(*) FILTER (WHERE state = 'DELIVERED' AND created_at < NOW() - $2::interval AND created_at >= NOW() - $3::interval)::int AS prev_delivered,
          COUNT(*) FILTER (WHERE created_at < NOW() - $2::interval AND created_at >= NOW() - $3::interval)::int AS prev_total_deliveries,
          COUNT(*) FILTER (WHERE state = 'DLQ' AND created_at >= NOW() - $2::interval)::int AS current_dlq,
          COUNT(*) FILTER (WHERE state = 'DLQ' AND created_at < NOW() - $2::interval AND created_at >= NOW() - $3::interval)::int AS prev_dlq
        FROM webhook_deliveries
        WHERE org_id = $1 AND created_at >= NOW() - $3::interval;
      `;
      const dlvRes = await client.query(deliveryQuery, [auth.orgId, config.interval, config.priorInterval]);
      const dlvData = dlvRes.rows[0] || {
        current_delivered: 0,
        current_total_deliveries: 0,
        prev_delivered: 0,
        prev_total_deliveries: 0,
        current_dlq: 0,
        prev_dlq: 0,
      };

      // Compute success rates & deltas
      const currentRate =
        dlvData.current_total_deliveries > 0
          ? Math.round((dlvData.current_delivered / dlvData.current_total_deliveries) * 10000) / 100
          : 100.0;
      const prevRate =
        dlvData.prev_total_deliveries > 0
          ? Math.round((dlvData.prev_delivered / dlvData.prev_total_deliveries) * 10000) / 100
          : 100.0;
      const rateDelta = Math.round((currentRate - prevRate) * 10) / 10;

      const ingestedDelta =
        kpiData.prev_ingested > 0
          ? Math.round(((kpiData.current_ingested - kpiData.prev_ingested) / kpiData.prev_ingested) * 1000) / 10
          : 0;

      const p99Delta = Math.round((kpiData.current_p99 - kpiData.prev_p99) * 10) / 10;
      const dlqDelta = dlvData.current_dlq - dlvData.prev_dlq;

      // 3. Time-Series Event Volume Buckets
      let series: Array<{ bucket?: string; t?: string; ingested: number; rateLimited: number }> = [];
      let topEventTypes: Array<{ name: string; count: number; percent: number }> = [];

      if (chRollup) {
        series = chRollup.volumeSeries.map((s) => ({
          bucket: s.bucket,
          t: s.bucket,
          ingested: s.ingested,
          rateLimited: s.rateLimited,
        }));
        topEventTypes = chRollup.topEventTypes;
      } else {
        const seriesQuery = `
          SELECT
            date_trunc($3, created_at) AS bucket,
            COUNT(*) FILTER (WHERE status_code = 202)::int AS ingested,
            COUNT(*) FILTER (WHERE status_code = 429)::int AS rate_limited
          FROM events
          WHERE org_id = $1 AND created_at >= NOW() - $2::interval
          GROUP BY 1
          ORDER BY 1 ASC;
        `;
        const seriesRes = await client.query(seriesQuery, [auth.orgId, config.interval, config.bucketTrunc]);
        series = seriesRes.rows.map((r) => ({
          bucket: new Date(r.bucket).toISOString(),
          t: new Date(r.bucket).toISOString(),
          ingested: r.ingested,
          rateLimited: r.rate_limited,
        }));

        // 4. Top Event Types Breakdown (Top 6 + other)
        const topEventsQuery = `
          WITH event_counts AS (
            SELECT
              event_name,
              COUNT(*)::int AS count
            FROM events
            WHERE org_id = $1 AND created_at >= NOW() - $2::interval
            GROUP BY event_name
          ),
          total AS (
            SELECT SUM(count)::int AS total_count FROM event_counts
          )
          SELECT
            ec.event_name,
            ec.count,
            ROUND((ec.count * 100.0 / NULLIF(t.total_count, 0))::numeric, 1) AS percent
          FROM event_counts ec, total t
          ORDER BY ec.count DESC;
        `;
        const topRes = await client.query(topEventsQuery, [auth.orgId, config.interval]);
        const rawTop = topRes.rows;

        topEventTypes = rawTop.slice(0, 6).map((r) => ({
          name: r.event_name,
          count: r.count,
          percent: parseFloat(r.percent) || 0,
        }));

        if (rawTop.length > 6) {
          const remaining = rawTop.slice(6);
          const otherCount = remaining.reduce((acc, r) => acc + r.count, 0);
          const otherPercent =
            Math.round(remaining.reduce((acc, r) => acc + (parseFloat(r.percent) || 0), 0) * 10) / 10;
          topEventTypes.push({
            name: "other",
            count: otherCount,
            percent: otherPercent,
          });
        }
      }

      const formattedSeries = series.map((s) => ({
        ...s,
        rate_limited: s.rateLimited,
      }));

      const formattedTopEventTypes = topEventTypes.map((t) => ({
        name: t.name,
        event_name: t.name,
        count: t.count,
        percent: t.percent,
        percentage: t.percent,
      }));

      return NextResponse.json({
        range: rangeParam,
        updated_at_utc: new Date().toISOString(),
        kpis: {
          eventsIngested: {
            value: kpiData.current_ingested,
            current: kpiData.current_ingested,
            previous: kpiData.prev_ingested,
            deltaPercent: ingestedDelta,
            delta_pct: ingestedDelta,
            deltaLabel: `${ingestedDelta >= 0 ? "+" : ""}${ingestedDelta}% vs prev ${rangeParam}`,
          },
          events_ingested: {
            value: kpiData.current_ingested,
            current: kpiData.current_ingested,
            previous: kpiData.prev_ingested,
            deltaPercent: ingestedDelta,
            delta_pct: ingestedDelta,
            deltaLabel: `${ingestedDelta >= 0 ? "+" : ""}${ingestedDelta}% vs prev ${rangeParam}`,
          },
          deliverySuccessRate: {
            value: currentRate,
            current: currentRate,
            previous: prevRate,
            delta: rateDelta,
            deltaPercent: rateDelta,
            delta_pct: rateDelta,
            deltaLabel: `${rateDelta >= 0 ? "+" : ""}${rateDelta}% vs prev ${rangeParam}`,
          },
          delivery_success_rate: {
            value: currentRate,
            current: currentRate,
            previous: prevRate,
            delta: rateDelta,
            deltaPercent: rateDelta,
            delta_pct: rateDelta,
            deltaLabel: `${rateDelta >= 0 ? "+" : ""}${rateDelta}% vs prev ${rangeParam}`,
          },
          p99LatencyMs: {
            value: Number(kpiData.current_p99) || 0,
            current: Number(kpiData.current_p99) || 0,
            previous: Number(kpiData.prev_p99) || 0,
            deltaMs: p99Delta,
            delta_pct: p99Delta,
            deltaLabel: `${p99Delta >= 0 ? "+" : ""}${p99Delta}ms vs prev ${rangeParam}`,
          },
          p99_latency_ms: {
            value: Number(kpiData.current_p99) || 0,
            current: Number(kpiData.current_p99) || 0,
            previous: Number(kpiData.prev_p99) || 0,
            deltaMs: p99Delta,
            delta_pct: p99Delta,
            deltaLabel: `${p99Delta >= 0 ? "+" : ""}${p99Delta}ms vs prev ${rangeParam}`,
          },
          dlqCount: {
            value: dlvData.current_dlq,
            current: dlvData.current_dlq,
            previous: dlvData.prev_dlq,
            delta: dlqDelta,
            delta_pct: dlqDelta,
            deltaLabel: `${dlqDelta >= 0 ? "+" : ""}${dlqDelta} vs prev ${rangeParam}`,
          },
          dlq_count: {
            value: dlvData.current_dlq,
            current: dlvData.current_dlq,
            previous: dlvData.prev_dlq,
            delta: dlqDelta,
            delta_pct: dlqDelta,
            deltaLabel: `${dlqDelta >= 0 ? "+" : ""}${dlqDelta} vs prev ${rangeParam}`,
          },
        },
        volumeSeries: formattedSeries,
        volume_series: formattedSeries,
        topEventTypes: formattedTopEventTypes,
        top_event_types: formattedTopEventTypes,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err, orgId: auth.orgId }, "Failed to load analytics overview data");
    return NextResponse.json(
      { error: "Failed to load analytics overview" },
      { status: 500 }
    );
  }
}
