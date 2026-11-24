"use client";

import React, { useState, useEffect } from "react";

interface StreamItem {
  id: string;
  type: "inbound" | "response" | "outbound" | "delivery";
  timestamp: string;
  badge?: { text: string; variant: "success" | "info" | "neutral" };
  headline: string;
  detail?: string;
}

const STREAM_ITEMS: StreamItem[] = [
  {
    id: "step_1",
    type: "inbound",
    timestamp: "02:14:08.120",
    badge: { text: "POST /v1/events", variant: "info" },
    headline: "Ingesting event: payment.succeeded",
    detail: '{"amount": 14900, "currency": "usd", "customer": "cus_92f8a1"}',
  },
  {
    id: "step_2",
    type: "response",
    timestamp: "02:14:08.126",
    badge: { text: "202 ACCEPTED", variant: "success" },
    headline: "Queued in 5.8ms • Buffer batch acked",
    detail: "ID: evt_01j9xk3m0007 • Rate limit: 249/250 rem",
  },
  {
    id: "step_3",
    type: "outbound",
    timestamp: "02:14:08.140",
    badge: { text: "FANOUT DISPATCH", variant: "neutral" },
    headline: "Matched pattern: payment.* → 1 endpoint",
    detail: "Endpoint: https://api.northwind.io/hooks/billing",
  },
  {
    id: "step_4",
    type: "delivery",
    timestamp: "02:14:08.192",
    badge: { text: "DELIVERED 200", variant: "success" },
    headline: "Signed delivery succeeded (52ms)",
    detail: "X-Webhook-Signature: t=1732414448,v1=9f8c...3e1a",
  },
];

export function HeroTerminal() {
  const [visibleCount, setVisibleCount] = useState(STREAM_ITEMS.length);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Respect prefers-reduced-motion media query
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener("change", listener);

    if (mediaQuery.matches) {
      setVisibleCount(STREAM_ITEMS.length);
      return () => mediaQuery.removeEventListener("change", listener);
    }

    // Gentle streaming cycle: resets and rolls in items
    let count = 1;
    setVisibleCount(1);
    const interval = setInterval(() => {
      count = count >= STREAM_ITEMS.length ? 1 : count + 1;
      setVisibleCount(count);
    }, 2400);

    return () => {
      clearInterval(interval);
      mediaQuery.removeEventListener("change", listener);
    };
  }, []);

  return (
    <div className="w-full border border-hairline bg-surface rounded-none overflow-hidden font-mono text-xs shadow-2xl">
      {/* Terminal Header */}
      <div className="h-9 bg-elevated border-b border-hairline flex items-center justify-between px-3.5">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-hairline-strong inline-block" />
          <span className="w-2.5 h-2.5 rounded-full bg-hairline-strong inline-block" />
          <span className="w-2.5 h-2.5 rounded-full bg-hairline-strong inline-block" />
          <span className="ml-2 text-[11px] text-ink-3 uppercase tracking-wider">
            event-pipeline.live
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-status-success uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
          Streaming
        </div>
      </div>

      {/* Terminal Body */}
      <div className="p-4 space-y-3 min-h-[300px] flex flex-col justify-start">
        {STREAM_ITEMS.slice(0, prefersReducedMotion ? STREAM_ITEMS.length : visibleCount).map(
          (item) => (
            <div
              key={item.id}
              className="border border-hairline-subtle bg-canvas/60 p-3 transition-opacity duration-200"
            >
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <div className="flex items-center gap-2">
                  {item.badge && (
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-semibold border ${
                        item.badge.variant === "success"
                          ? "text-emerald bg-emerald-subtle border-emerald/30"
                          : item.badge.variant === "info"
                          ? "text-accent bg-accent/10 border-accent/30"
                          : "text-ink-2 bg-elevated border-hairline"
                      }`}
                    >
                      {item.badge.text}
                    </span>
                  )}
                  <span className="text-ink font-medium">{item.headline}</span>
                </div>
                <span className="text-ink-3 text-[10px] tabular-nums">{item.timestamp}</span>
              </div>
              {item.detail && (
                <div className="text-[11px] text-ink-2 pl-2 border-l border-hairline truncate">
                  {item.detail}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Terminal Footer */}
      <div className="h-8 bg-elevated/70 border-t border-hairline-subtle px-3.5 flex items-center justify-between text-[10px] text-ink-3">
        <span>AES-256-GCM SECRETS • HMAC-SHA256 SIGNED</span>
        <span className="text-emerald tabular-nums">LATENCY 5.8ms</span>
      </div>
    </div>
  );
}
