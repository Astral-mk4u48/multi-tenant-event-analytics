"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
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
  RefreshCw,
  Eye,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useDrawer } from "@/components/drawer/DrawerContext";
import { QuickstartChecklist } from "@/components/onboarding/QuickstartChecklist";
import { SendTestEventDrawer } from "@/components/playground/SendTestEventDrawer";

// Safe localStorage access guarded against strict privacy sandbox exceptions
function safeGetStorage(key: string): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // Storage access restricted by browser policy
  }
  return null;
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Storage quota exceeded or disabled
  }
}

interface KpiMetric {
  value?: number;
  current?: number;
  previous?: number;
  delta?: number;
  deltaPercent?: number;
  delta_pct?: number;
  deltaLabel?: string;
  deltaMs?: number;
}

interface OverviewResponse {
  kpis?: {
    eventsIngested?: KpiMetric;
    events_ingested?: KpiMetric;
    deliverySuccessRate?: KpiMetric;
    delivery_success_rate?: KpiMetric;
    p99LatencyMs?: KpiMetric;
    p99_latency_ms?: KpiMetric;
    dlqCount?: KpiMetric;
    dlq_count?: KpiMetric;
  };
  volumeSeries?: Array<{
    bucket: string;
    ingested: number;
    rateLimited?: number;
    rate_limited?: number;
  }>;
  volume_series?: Array<{
    bucket: string;
    ingested: number;
    rateLimited?: number;
    rate_limited?: number;
  }>;
  topEventTypes?: Array<{
    name?: string;
    event_name?: string;
    count: number;
    percent?: number;
    percentage?: number;
  }>;
  top_event_types?: Array<{
    name?: string;
    event_name?: string;
    count: number;
    percent?: number;
    percentage?: number;
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
  const searchParams = useSearchParams();
  const rangeParam = searchParams.get("range");
  const range: "1h" | "24h" | "7d" | "30d" =
    rangeParam === "1h" || rangeParam === "7d" || rangeParam === "30d"
      ? rangeParam
      : "24h";

  const [isMounted, setIsMounted] = useState(false);
  const [isTestDrawerOpen, setIsTestDrawerOpen] = useState(false);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [recentFailures, setRecentFailures] = useState<DeliveryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [replayingId, setReplayingId] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

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
    } catch {
      // Handled gracefully
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
        fetchOverview();
      }
    } catch {
      // Replay handled gracefully
    } finally {
      setReplayingId(null);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toLocaleString();
  };

  // Safe KPI value extractors with fallbacks across both naming conventions
  const eventsMetric = data?.kpis?.events_ingested ?? data?.kpis?.eventsIngested;
  const eventsCurrent = eventsMetric?.current ?? eventsMetric?.value ?? 0;
  const eventsPrev = eventsMetric?.previous ?? 0;

  // Sane KPI Ingestion Delta: % only if baseline >= 20 events
  let formattedEventsDelta: string | undefined;
  if (eventsPrev >= 20 && eventsMetric?.delta_pct !== undefined) {
    const p = eventsMetric.delta_pct;
    formattedEventsDelta = `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
  } else if (eventsPrev > 0) {
    const diff = eventsCurrent - eventsPrev;
    formattedEventsDelta = `${diff >= 0 ? "+" : ""}${diff} events`;
  } else {
    formattedEventsDelta = "no prior data";
  }

  const rateMetric = data?.kpis?.delivery_success_rate ?? data?.kpis?.deliverySuccessRate;
  const rateCurrent = rateMetric?.current ?? rateMetric?.value ?? 0;
  const rateDeltaFormatted = rateCurrent >= 99.0 ? "TARGET MET (≥99%)" : "BELOW TARGET (<99%)";
  const rateDeltaType: "positive" | "negative" = rateCurrent >= 99.0 ? "positive" : "negative";

  const p99Metric = data?.kpis?.p99_latency_ms ?? data?.kpis?.p99LatencyMs;
  const p99Current = p99Metric?.current ?? p99Metric?.value ?? 0;
  const p99DeltaFormatted = p99Current <= 250 ? "TARGET MET (≤250ms)" : "ELEVATED (>250ms)";
  const p99DeltaType: "positive" | "negative" = p99Current <= 250 ? "positive" : "negative";

  const dlqMetric = data?.kpis?.dlq_count ?? data?.kpis?.dlqCount;
  const dlqCurrent = dlqMetric?.current ?? dlqMetric?.value ?? 0;
  const dlqPrev = dlqMetric?.previous ?? 0;
  const dlqDiff = dlqCurrent - dlqPrev;
  const formattedDlqDelta = `${dlqDiff >= 0 ? "+" : ""}${dlqDiff}`;

  // Normalized time series array
  const volumeSeries = (data?.volume_series ?? data?.volumeSeries ?? []).map((item) => ({
    bucket: item.bucket,
    ingested: item.ingested,
    rate_limited: item.rate_limited ?? item.rateLimited ?? 0,
  }));

  const totalRateLimited = volumeSeries.reduce((acc, curr) => acc + (curr.rate_limited || 0), 0);

  // Normalized top event types array
  const topEvents = (data?.top_event_types ?? data?.topEventTypes ?? []).map((item) => ({
    eventName: item.event_name ?? item.name ?? "unknown",
    count: item.count,
    percentage: item.percentage ?? item.percent ?? 0,
  }));

  return (
    <div className="space-y-6">
      {/* Page Header (Single source of truth: range is controlled exclusively in Topbar) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="type-page-title text-ink">Overview</h1>
          <p className="type-body text-ink-3 mt-1">
            Real-time pipeline metrics and outbound delivery status
          </p>
        </div>

        <div className="flex items-center gap-3">
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

      {/* Quickstart Checklist for 0-event organizations */}
      <QuickstartChecklist onOpenTestEvent={() => setIsTestDrawerOpen(true)} />

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Events Ingested"
          value={isLoading ? "—" : formatNumber(eventsCurrent)}
          delta={formattedEventsDelta}
          deltaType="positive"
          subtitle={`vs previous ${range}`}
          icon={Activity}
          loading={isLoading}
        />
        <KpiCard
          title="Delivery Success Rate"
          value={isLoading ? "—" : `${rateCurrent.toFixed(1)}%`}
          delta={rateDeltaFormatted}
          deltaType={rateDeltaType}
          subtitle="Target: ≥ 99.0%"
          icon={CheckCircle2}
          loading={isLoading}
        />
        <KpiCard
          title="p99 Ingestion Latency"
          value={isLoading ? "—" : `${p99Current}ms`}
          delta={p99DeltaFormatted}
          deltaType={p99DeltaType}
          subtitle="Target: ≤ 250ms"
          icon={Clock}
          loading={isLoading}
        />
        <KpiCard
          title="Dead Letter Queue"
          value={isLoading ? "—" : dlqCurrent.toString()}
          delta={formattedDlqDelta}
          deltaType="neutral"
          subtitle="Undelivered webhooks"
          icon={AlertTriangle}
          loading={isLoading}
          badgeText={dlqCurrent > 0 ? "ATTENTION" : undefined}
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
              <span className="text-ink-2">
                Rate limited: {totalRateLimited.toLocaleString()} total
              </span>
            </div>
          </div>
        </div>

        <div className="h-72 w-full">
          {!isMounted || isLoading ? (
            <div className="h-full w-full flex items-center justify-center">
              <div className="flex items-center gap-2 text-ink-3 type-micro mono-data">
                <RotateCw className="w-4 h-4 animate-spin" />
                <span>Loading telemetry series...</span>
              </div>
            </div>
          ) : volumeSeries.length === 0 ? (
            <div className="h-full w-full flex items-center justify-center border border-hairline-subtle bg-inset">
              <p className="type-micro text-ink-3">No event volume recorded in this time range.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={volumeSeries}
                margin={{ top: 10, right: 20, left: 10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="ingestGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E11D48" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#E11D48" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="2 2"
                  stroke="#1E1E24"
                  vertical={false}
                />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={(val) => {
                    const d = new Date(val);
                    return range === "1h"
                      ? `${String(d.getUTCMinutes()).padStart(2, "0")}m`
                      : `${String(d.getUTCHours()).padStart(2, "0")}:00`;
                  }}
                  tick={{ fill: "#63636E", fontSize: 11, fontFamily: "var(--font-geist-mono)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "#63636E", fontSize: 11, fontFamily: "var(--font-geist-mono)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatNumber(v)}
                  width={45}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: "#3F3F4A", strokeWidth: 1 }}
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
                  type="stepAfter"
                  dataKey="ingested"
                  stroke="#E11D48"
                  strokeWidth={1.5}
                  fillOpacity={1}
                  fill="url(#ingestGradient)"
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{ r: 3, fill: "#E11D48", stroke: "#0F0F12", strokeWidth: 1 }}
                />
                <Line
                  type="stepAfter"
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
            ) : topEvents.length === 0 ? (
              <div className="h-40 flex items-center justify-center border border-hairline-subtle bg-inset">
                <p className="type-micro text-ink-3">No event types recorded.</p>
              </div>
            ) : (
              topEvents.map((evt) => (
                <div key={evt.eventName} className="space-y-1">
                  <div className="flex items-center justify-between type-micro">
                    <span className="text-ink mono-data font-medium truncate max-w-[180px]">
                      {evt.eventName}
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
                      No failed deliveries in Dead Letter Queue. All webhook dispatches nominal.
                    </td>
                  </tr>
                ) : (
                  recentFailures.map((item) => {
                    const urlDetails = (() => {
                      try {
                        const parsed = new URL(item.endpoint_url);
                        return { host: parsed.host, path: parsed.pathname };
                      } catch {
                        return { host: item.endpoint_url, path: "" };
                      }
                    })();

                    return (
                      <tr
                        key={item.id}
                        className="h-11 hover:bg-elevated/40 transition-colors text-ink type-body"
                      >
                        <td className="px-2 mono-data font-medium text-ink truncate max-w-[140px]">
                          {item.event_name}
                        </td>
                        <td className="px-2 mono-data text-ink-2 truncate max-w-[200px]" title={item.endpoint_url}>
                          <span className="text-ink font-medium">{urlDetails.host}</span>
                          <span className="text-ink-3">{urlDetails.path}</span>
                        </td>
                        <td className="px-2 mono-data">
                          <Badge variant="neutral">
                            {item.attempt_count}/{item.max_attempts}
                          </Badge>
                        </td>
                        <td className="px-2 text-crimson mono-data truncate max-w-[140px]">
                          {item.last_status_code
                            ? `HTTP ${item.last_status_code}`
                            : item.last_error || "TIMEOUT"}
                        </td>
                        <td className="px-2 mono-data text-ink-3">
                          {new Date(item.created_at).toISOString().substring(11, 19)}
                        </td>
                        <td className="px-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDrawer(item.id)}
                              className="h-8 px-2.5 text-ink-2 hover:text-ink flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Inspect</span>
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={replayingId === item.id}
                              onClick={() => handleReplay(item.id)}
                              className="h-8 px-2.5 text-ink flex items-center gap-1"
                            >
                              <RotateCw
                                className={`w-3.5 h-3.5 ${
                                  replayingId === item.id ? "animate-spin" : ""
                                }`}
                              />
                              <span>Replay</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <SendTestEventDrawer
        isOpen={isTestDrawerOpen}
        onClose={() => setIsTestDrawerOpen(false)}
      />
    </div>
  );
}
