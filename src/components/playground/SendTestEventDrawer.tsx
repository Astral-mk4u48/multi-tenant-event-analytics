"use client";

import React, { useState } from "react";

export function SendTestEventDrawer({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [eventType, setEventType] = useState("payment.succeeded");
  const [payload, setPayload] = useState(
    JSON.stringify({ id: "evt_123", amount: 4900, currency: "usd" }, null, 2)
  );
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<{
    status: number;
    latency: number;
    body: any;
  } | null>(null);

  if (!isOpen) return null;

  async function handleSend() {
    setLoading(true);
    const start = performance.now();
    try {
      const res = await fetch("/api/v1/events/test-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, payload: JSON.parse(payload) }),
      });
      const data = await res.json();
      const duration = Math.round(performance.now() - start);
      setResponse({ status: res.status, latency: duration, body: data });
    } catch (err: any) {
      setResponse({ status: 500, latency: 0, body: { error: err.message } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-drawer flex w-full max-w-lg flex-col border-l border-hairline bg-surface p-6">
      <div className="flex items-center justify-between border-b border-hairline-subtle pb-4">
        <h3 className="type-section text-ink font-semibold">Send Test Event</h3>
        <button
          onClick={onClose}
          className="text-xs text-ink-3 hover:text-ink transition-colors p-1"
        >
          Close
        </button>
      </div>

      <div className="mt-4 space-y-4 flex-1 overflow-y-auto">
        <div>
          <label className="type-micro text-ink-2 uppercase font-medium">Event Type</label>
          <input
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="mt-1 w-full rounded-sm border border-hairline bg-elevated px-3 py-2 text-xs text-ink focus:outline-none focus:border-accent mono-data"
          />
        </div>

        <div>
          <label className="type-micro text-ink-2 uppercase font-medium">JSON Payload</label>
          <textarea
            rows={8}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            className="mt-1 w-full rounded-sm border border-hairline bg-inset p-3 font-mono text-xs text-ink focus:outline-none focus:border-accent"
          />
        </div>

        <button
          onClick={handleSend}
          disabled={loading}
          className="w-full rounded-sm bg-accent py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-accent-hover disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Dispatching..." : "Dispatch Event"}
        </button>

        {response && (
          <div className="mt-4 rounded-sm border border-hairline bg-elevated p-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span
                className={
                  response.status === 202 ? "text-status-success" : "text-status-error"
                }
              >
                HTTP {response.status}
              </span>
              <span className="text-ink-3 mono-data">{response.latency} ms</span>
            </div>
            <pre className="mt-2 overflow-x-auto text-[11px] font-mono text-ink bg-inset p-2 rounded-xs border border-hairline-subtle">
              {JSON.stringify(response.body, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
