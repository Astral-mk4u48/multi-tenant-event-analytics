"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Activity,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCw,
  Eye,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useDrawer } from "@/components/drawer/DrawerContext";

interface KpiData {
  current: number;
  previous: number;
  delta_pct: number;
}

interface OverviewResponse {
  kpis: {
    events_ingested: KpiData;
    delivery_success_rate: KpiData;
    p99_latency_ms: KpiData;
    dlq_count: KpiData;
  };
  volume_series: Array<{
    bucket: string;
    ingested: number;
    rate_limited: number;
  }>;
  top_event_types: Array<{
    event_name: string;
    count: number;
    percentage: number;
  }>;
}

interface DeliveryItem {
  id: string;
  event_name: string;
  endpoint_url: string;
  state: "PENDING" | "DELIVERED" | "FAILED" | "DLQ";
  attempt_count: number;
  max_attempts: number;
  last_status_code: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  created_at: string;
}

export default function OverviewPage() {
  const { openDrawer } = useDrawer();
  const [range, setRange] = useState<"1h" | "24h" | "7d" | "30d">("24h");
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [recentFailures, setRecentFailures] = useState<DeliveryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [replayingId, setReplayingId] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const [overviewRes, failuresRes] = await Promise.all([
        fetch(`/api/v1/analytics/overview?range=${range}`),
        fetch(`/api/v1/deliveries?state=DLQ&limit=6`),
      ]);

      if (overviewRes.ok) {
        const overviewJson = await overviewRes.json();
        setData(overviewJson);
      }

      if (failuresRes.ok) {
        const failuresJson = await failuresRes.json();
        setRecentFailures(failuresJson.data || []);
      }
    } catch (err) {
      console.error("Failed to load overview data", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const handleReplay = async (deliveryId: string) => {
    try {
      setReplayingId(deliveryId);
      const res = await fetch(`/api/v1/deliveries/${deliveryId}/replay`, {
        method: "POST",
      });
      if (res.ok) {
        // Refresh list
        fetchOverview();
      }
    } catch (err) {
      console.error("Replay failed", err);
    } finally {
      setReplayingId(null);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="type-page-title text-ink">Overview</h1>
          <p className="type-body text-ink-3 mt-1">
            Real-time pipeline metrics and outbound delivery status
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Segmented Range Selector */}
          <div className="flex items-center bg-surface border border-hairline-subtle p-0.5">
            {(["1h", "24h", "7d", "30d"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 type-micro mono-data transition-colors ${
                  range === r
                    ? "bg-elevated text-ink font-semibold"
                    : "text-ink-3 hover:text-ink"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchOverview}
            disabled={isRefreshing}
            className="flex items-center gap-1.5"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            <span className="type-micro">Refresh</span>
          </Button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Events Ingested"
          value={isLoading ? "—" : formatNumber(data?.kpis.events_ingested.current || 0)}
          delta={data?.kpis.events_ingested.delta_pct}
          deltaType="positive"
          subtitle={`vs previous ${range}`}
          icon={Activity}
          loading={isLoading}
        />
        <KpiCard
          title="Delivery Success Rate"
          value={isLoading ? "—" : `${data?.kpis.delivery_success_rate.current.toFixed(1) || 0}%`}
          delta={data?.kpis.delivery_success_rate.delta_pct}
          deltaType="positive"
          subtitle="Target: ≥ 99.0%"
          icon={CheckCircle2}
          loading={isLoading}
        />
        <KpiCard
          title="p99 Ingestion Latency"
          value={isLoading ? "—" : `${data?.kpis.p99_latency_ms.current || 0}ms`}
          delta={data?.kpis.p99_latency_ms.delta_pct}
          deltaType="negative"
          subtitle="Target: ≤ 250ms"
          icon={Clock}
          loading={isLoading}
        />
        <KpiCard
          title="Dead Letter Queue"
          value={isLoading ? "—" : (data?.kpis.dlq_count.current || 0).toString()}
          delta={data?.kpis.dlq_count.delta_pct}
          deltaType="neutral"
          subtitle="Undelivered webhooks"
          icon={AlertTriangle}
          loading={isLoading}
          badgeText={(data?.kpis.dlq_count.current ?? 0) > 0 ? "ATTENTION" : undefined}
          badgeVariant="crimson"
        />
      </div>

      {/* Main Event Volume Chart */}
      <div className="bg-surface border border-hairline-subtle p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="type-heading text-ink">Event Ingestion Volume</h2>
            <p className="type-micro text-ink-3 mt-0.5">
              Dual-series ingress: Accepted vs Rate Limited (429)
            </p>
          </div>
          <div className="flex items-center gap-4 type-micro">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-crimson" />
              <span className="text-ink-2">Ingested</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-amber" />
              <span className="text-ink-2">Rate Limited (429)</span>
            </div>
          </div>
        </div>

        <div className="h-72 w-full">
          {isLoading ? (
            <div className="h-full w-full flex items-center justify-center">
              <div className="flex items-center gap-2 text-ink-3 type-micro mono-data">
                <RotateCw className="w-4 h-4 animate-spin" />
                <span>Loading telemetry series...</span>
              </div>
            </div>
          ) : !data?.volume_series || data.volume_series.length === 0 ? (
            <div className="h-full w-full flex items-center justify-center border border-hairline-subtle bg-inset">
              <p className="type-micro text-ink-3">No event volume recorded in this time range.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.volume_series}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="ingestGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E11D48" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#E11D48" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border-hairline-subtle)"
                  vertical={false}
                />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(val) => {
                    const d = new Date(val);
                    return range === "1h"
                      ? `${d.getUTCMinutes()}m`
                      : `${d.getUTCHours()}:00`;
                  }}
                  stroke="var(--text-ink-3)"
                  tick={{ fill: "var(--text-ink-3)", fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
                  axisLine={{ stroke: "var(--border-hairline-subtle)" }}
                  tickLine={false}
                />
                <YAxis
                  stroke="var(--text-ink-3)"
                  tick={{ fill: "var(--text-ink-3)", fontSize: 10, fontFamily: "var(--font-geist-mono)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatNumber(v)}
                />
                <Tooltip
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const item = payload[0].payload;
                      return (
                        <div className="bg-elevated border border-hairline p-2 text-ink shadow-none">
                          <p className="type-micro text-ink-3 mono-data mb-1">
                            {new Date(item.bucket).toUTCString()}
                          </p>
                          <div className="flex items-center justify-between gap-4 type-micro">
                            <span className="text-crimson font-medium">Ingested:</span>
                            <span className="mono-data font-semibold">
                              {item.ingested.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4 type-micro mt-0.5">
                            <span className="text-amber font-medium">Rate Limited:</span>
                            <span className="mono-data font-semibold">
                              {item.rate_limited.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="ingested"
                  stroke="#E11D48"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#ingestGradient)"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="rate_limited"
                  stroke="#F59E0B"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Two Column Grid: Top Event Types & Recent Failed Deliveries */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Event Types (1 col) */}
        <div className="bg-surface border border-hairline-subtle p-5 flex flex-col">
          <h2 className="type-heading text-ink">Top Event Types</h2>
          <p className="type-micro text-ink-3 mt-0.5 mb-4">
            Ingestion distribution by name
          </p>

          <div className="flex-1 space-y-3">
            {isLoading ? (
              <div className="h-40 flex items-center justify-center">
                <span className="type-micro text-ink-3 mono-data">Loading metrics...</span>
              </div>
            ) : !data?.top_event_types || data.top_event_types.length === 0 ? (
              <div className="h-40 flex items-center justify-center border border-hairline-subtle bg-inset">
                <p className="type-micro text-ink-3">No event types recorded.</p>
              </div>
            ) : (
              data.top_event_types.map((evt) => (
                <div key={evt.event_name} className="space-y-1">
                  <div className="flex items-center justify-between type-micro">
                    <span className="text-ink mono-data font-medium truncate max-w-[180px]">
                      {evt.event_name}
                    </span>
                    <span className="text-ink-2 mono-data">
                      {formatNumber(evt.count)} ({evt.percentage.toFixed(1)}%)
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full bg-inset overflow-hidden">
                    <div
                      className="h-full bg-crimson"
                      style={{ width: `${Math.min(100, evt.percentage)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Failed Deliveries (2 cols) */}
        <div className="lg:col-span-2 bg-surface border border-hairline-subtle p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="type-heading text-ink">Recent Failed Deliveries</h2>
              <p className="type-micro text-ink-3 mt-0.5">
                Exhausted retries placed into Dead Letter Queue
              </p>
            </div>
            <Badge variant="crimson">
              {recentFailures.length} In DLQ
            </Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-hairline-subtle h-8 text-ink-3 type-label">
                  <th className="font-normal px-2">Event</th>
                  <th className="font-normal px-2">Endpoint</th>
                  <th className="font-normal px-2">Attempts</th>
                  <th className="font-normal px-2">Last Error</th>
                  <th className="font-normal px-2">Time (UTC)</th>
                  <th className="font-normal px-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-subtle">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-ink-3 type-micro mono-data">
                      Loading failures...
                    </td>
                  </tr>
                ) : recentFailures.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-ink-3 type-micro">
                      All webhooks delivered cleanly. Zero items in DLQ.
                    </td>
                  </tr>
                ) : (
                  recentFailures.map((item) => (
                    <tr
                      key={item.id}
                      className="h-11 hover:bg-elevated/40 transition-colors text-ink type-body"
                    >
                      <td className="px-2 mono-data font-medium text-ink-2 truncate max-w-[140px]">
                        {item.event_name}
                      </td>
                      <td className="px-2 mono-data text-ink-3 truncate max-w-[180px]">
                        {item.endpoint_url}
                      </td>
                      <td className="px-2 mono-data text-ink-2">
                        {item.attempt_count}/{item.max_attempts}
                      </td>
                      <td className="px-2 mono-data text-crimson truncate max-w-[140px]">
                        {item.last_error || `HTTP ${item.last_status_code}`}
                      </td>
                      <td className="px-2 mono-data text-ink-3 type-micro whitespace-nowrap">
                        {new Date(item.created_at).toISOString().substring(11, 19)}
                      </td>
                      <td className="px-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDrawer(item.id)}
                            className="h-7 px-2 text-ink-2 hover:text-ink"
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            <span className="type-micro">Inspect</span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleReplay(item.id)}
                            disabled={replayingId === item.id}
                            className="h-7 px-2 text-ink"
                          >
                            <RotateCw
                              className={`w-3.5 h-3.5 mr-1 ${
                                replayingId === item.id ? "animate-spin" : ""
                              }`}
                            />
                            <span className="type-micro">Replay</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
