"use client";

import React, { useEffect, useState, useCallback } from "react";
import { X, Copy, Check, RotateCw } from "lucide-react";
import { useDrawer } from "./DrawerContext";
import { Button } from "../ui/Button";
import { HttpStatusBadge } from "../ui/Badge";

interface DeliveryDetail {
  id: string;
  event_id: string;
  event_name: string;
  endpoint_id: string;
  endpoint_url: string;
  endpoint_active: boolean;
  state: "QUEUED" | "DELIVERED" | "RETRYING" | "DLQ";
  status_code: number | null;
  is_timeout: boolean;
  latency_ms: number;
  attempt_count: number;
  max_attempts: number;
  timestamp_utc: string;
  signature_prefix: string;
  latest_attempt: {
    request_headers: Record<string, string>;
    request_body: Record<string, unknown>;
    response_headers: Record<string, string>;
    response_body: string;
    response_truncated: boolean;
  } | null;
  attempts: Array<{
    attempt_number: number;
    timestamp_utc: string;
    status_code: number | null;
    is_timeout: boolean;
    latency_ms: number;
    next_retry_delay_ms: number | null;
    trigger: "auto" | "manual";
  }>;
}

type TabKey = "request" | "response" | "headers" | "attempts";

export function PayloadDrawer() {
  const { selectedDeliveryId, closeDrawer } = useDrawer();
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("request");
  const [isLoading, setIsLoading] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchDetail = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/deliveries/${id}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
      }
    } catch {
      // Fetch error handled by fallback UI
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDeliveryId) {
      fetchDetail(selectedDeliveryId);
      setActiveTab("request");
    } else {
      setDetail(null);
    }
  }, [selectedDeliveryId, fetchDetail]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleReplay = async () => {
    if (!detail) return;
    setIsReplaying(true);
    try {
      const res = await fetch(`/api/v1/deliveries/${detail.id}/replay`, {
        method: "POST",
      });
      if (res.ok) {
        // Refresh detail
        await fetchDetail(detail.id);
      }
    } finally {
      setIsReplaying(false);
    }
  };

  // Keyboard navigation inside drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedDeliveryId) return;

      if (e.key === "Escape") {
        closeDrawer();
      } else if (e.key === "ArrowLeft") {
        setActiveTab((prev) => {
          if (prev === "attempts") return "headers";
          if (prev === "headers") return "response";
          if (prev === "response") return "request";
          return "request";
        });
      } else if (e.key === "ArrowRight") {
        setActiveTab((prev) => {
          if (prev === "request") return "response";
          if (prev === "response") return "headers";
          if (prev === "headers") return "attempts";
          return "attempts";
        });
      } else if (e.key.toLowerCase() === "r" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        handleReplay();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDeliveryId, closeDrawer, handleReplay]);

  if (!selectedDeliveryId) return null;

  const prettyPayload = detail?.latest_attempt?.request_body
    ? JSON.stringify(detail.latest_attempt.request_body, null, 2)
    : "{}";

  const curlCommand = detail
    ? `curl -X POST '${detail.endpoint_url}' \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-Webhook-Id: ${detail.id}' \\\n  -d '${JSON.stringify(detail.latest_attempt?.request_body || {})}'`
    : "";

  return (
    <>
      {/* Scrim (z 39, rgba 0.5, no blur) */}
      <div
        className="fixed inset-0 bg-black/50 z-[39] transition-opacity duration-150"
        onClick={closeDrawer}
        aria-hidden="true"
      />

      {/* Drawer (z 40, 540px fixed width) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payload Inspector"
        className="fixed top-0 right-0 bottom-0 w-[540px] max-w-full bg-surface border-l border-hairline z-drawer flex flex-col transition-transform duration-150 ease-out"
      >
        {/* Drawer Header (56px) */}
        <div className="h-[56px] px-4 border-b border-hairline-subtle flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="type-section mono-data truncate">{selectedDeliveryId}</span>
            <button
              onClick={() => handleCopy(selectedDeliveryId, "id")}
              className="text-ink-3 hover:text-ink transition-colors p-1"
              title="Copy Delivery ID"
            >
              {copiedKey === "id" ? <Check size={14} className="text-status-success" /> : <Copy size={14} />}
            </button>
            {detail && <HttpStatusBadge status={detail.status_code} isTimeout={detail.is_timeout} />}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<RotateCw size={12} className={isReplaying ? "animate-spin" : ""} />}
              isLoading={isReplaying}
              onClick={handleReplay}
              disabled={detail?.endpoint_active === false}
              title="Replay Webhook (R)"
            >
              Replay Webhook
            </Button>
            <button
              onClick={closeDrawer}
              className="text-ink-3 hover:text-ink p-1 transition-colors"
              title="Close Drawer (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Metadata Grid (2-col) */}
        <div className="p-4 border-b border-hairline-subtle text-[12px] bg-canvas/30 shrink-0 space-y-2">
          <div>
            <div className="type-micro uppercase text-ink-3">Endpoint URL</div>
            <div className="flex items-center justify-between gap-2 mt-0.5">
              <span className="mono-data truncate text-ink">{detail?.endpoint_url || "..."}</span>
              {detail && (
                <button
                  onClick={() => handleCopy(detail.endpoint_url, "url")}
                  className="text-ink-3 hover:text-ink shrink-0"
                >
                  {copiedKey === "url" ? <Check size={12} className="text-status-success" /> : <Copy size={12} />}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <div className="type-micro uppercase text-ink-3">Latency</div>
              <div className="mono-data text-ink mt-0.5">
                {detail?.is_timeout ? "TIMEOUT" : `${detail?.latency_ms ?? 0}ms`}
              </div>
            </div>
            <div>
              <div className="type-micro uppercase text-ink-3">Attempt</div>
              <div className="mono-data text-ink mt-0.5">
                {detail ? `${detail.attempt_count} / ${detail.max_attempts} - ${detail.state}` : "..."}
              </div>
            </div>
            <div>
              <div className="type-micro uppercase text-ink-3">Timestamp (UTC)</div>
              <div className="mono-data text-ink mt-0.5">
                {detail?.timestamp_utc ? detail.timestamp_utc.replace("T", " ").replace("Z", " UTC") : "..."}
              </div>
            </div>
            <div>
              <div className="type-micro uppercase text-ink-3">HMAC-SHA256</div>
              <div className="mono-data text-ink-2 mt-0.5 truncate">
                {detail?.signature_prefix || "..."}
              </div>
            </div>
          </div>
        </div>

        {/* 4 Tabs Header (36px, crimson underline on active) */}
        <div className="h-[36px] px-4 border-b border-hairline-subtle flex items-center gap-6 shrink-0 bg-surface">
          {(["request", "response", "headers", "attempts"] as TabKey[]).map((tab) => {
            const labels: Record<TabKey, string> = {
              request: "Request Payload",
              response: "Response Body",
              headers: "Headers",
              attempts: "Attempt History",
            };
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`h-full text-[13px] font-medium transition-colors border-b-2 relative ${
                  isActive ? "text-ink border-accent" : "text-ink-2 border-transparent hover:text-ink"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto scrollbar-dark p-4 bg-surface">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-4 skeleton rounded-xs w-full" />
              ))}
            </div>
          ) : activeTab === "request" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copiedKey === "json" ? <Check size={12} className="text-status-success" /> : <Copy size={12} />}
                  onClick={() => handleCopy(prettyPayload, "json")}
                >
                  {copiedKey === "json" ? "Copied" : "Copy JSON"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copiedKey === "curl" ? <Check size={12} className="text-status-success" /> : <Copy size={12} />}
                  onClick={() => handleCopy(curlCommand, "curl")}
                >
                  {copiedKey === "curl" ? "Copied" : "Copy as cURL"}
                </Button>
              </div>

              {/* Inset JSON Viewer (#050507) with line numbers */}
              <div className="bg-inset border border-hairline rounded p-3 font-mono text-[12px] leading-[18px] overflow-x-auto scrollbar-dark">
                <table className="w-full border-collapse">
                  <tbody>
                    {prettyPayload.split("\n").map((line, idx) => (
                      <tr key={idx}>
                        <td className="w-9 pr-3 text-right text-ink-3 select-none tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="text-json-string whitespace-pre">
                          {highlightJsonLine(line)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === "response" ? (
            <div className="space-y-3">
              {detail?.latest_attempt?.response_truncated && (
                <div className="p-2 border border-status-warning/30 bg-status-warning/10 text-status-warning text-[11px] mono-data rounded">
                  Truncated at 64 KB per outbound defense policy
                </div>
              )}
              <div className="bg-inset border border-hairline rounded-sm p-3 font-mono text-[12px] leading-[18px] text-json-string overflow-x-auto scrollbar-dark whitespace-pre-wrap">
                {detail?.latest_attempt?.response_body || "No response body (connection closed before response)"}
              </div>
            </div>
          ) : activeTab === "headers" ? (
            <div className="border border-hairline rounded overflow-hidden">
              <table className="w-full text-left text-[12px] mono-data">
                <thead className="bg-elevated hairline-b text-ink-3 uppercase type-micro">
                  <tr>
                    <th className="py-2 px-3">Header</th>
                    <th className="py-2 px-3">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline-subtle">
                  {Object.entries(detail?.latest_attempt?.request_headers || {}).map(([k, v]) => (
                    <tr key={k} className="hover:bg-elevated/40">
                      <td className="py-2 px-3 text-ink-2">{k}</td>
                      <td className="py-2 px-3 text-ink break-all">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Attempt History Tab */
            <div className="border border-hairline rounded overflow-hidden">
              <table className="w-full text-left text-[12px] mono-data">
                <thead className="bg-elevated hairline-b text-ink-3 uppercase type-micro">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Timestamp</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3 text-right">Latency</th>
                    <th className="py-2 px-3">Trigger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline-subtle">
                  {detail?.attempts.map((att) => (
                    <tr key={att.attempt_number} className="hover:bg-elevated/40">
                      <td className="py-2 px-3 text-ink">{att.attempt_number}</td>
                      <td className="py-2 px-3 text-ink-2">
                        {att.timestamp_utc.slice(11, 23)}
                      </td>
                      <td className="py-2 px-3">
                        <HttpStatusBadge status={att.status_code} isTimeout={att.is_timeout} />
                      </td>
                      <td className="py-2 px-3 text-right text-ink">
                        {att.latency_ms}ms
                      </td>
                      <td className="py-2 px-3 text-ink-3 uppercase text-[11px]">
                        {att.trigger}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Simple JSON syntax high-lighter for machine readable lines
function highlightJsonLine(line: string): React.ReactNode {
  // Key regex: "key":
  const keyMatch = line.match(/^(\s*"[^"]+")(\s*:\s*)(.*)$/);
  if (keyMatch) {
    const [, key, colon, rest] = keyMatch;
    let restColored: React.ReactNode = rest;

    if (rest.startsWith('"')) {
      restColored = <span className="text-json-string">{rest}</span>;
    } else if (rest.match(/^-?\d+(\.\d+)?/)) {
      restColored = <span className="text-accent">{rest}</span>;
    } else if (rest === "true," || rest === "false," || rest === "true" || rest === "false") {
      restColored = <span className="text-accent">{rest}</span>;
    } else if (rest === "null," || rest === "null") {
      restColored = <span className="text-ink-3">{rest}</span>;
    }

    return (
      <>
        <span className="text-ink-2">{key}</span>
        <span className="text-ink-3">{colon}</span>
        {restColored}
      </>
    );
  }
  return line;
}
