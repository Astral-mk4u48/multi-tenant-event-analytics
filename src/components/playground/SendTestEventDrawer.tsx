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
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-[#1E1E24] bg-[#0F0F12] p-6 shadow-2xl">
      <div className="flex items-center justify-between border-b border-[#1E1E24] pb-4">
        <h3 className="text-sm font-semibold text-[#F1F5F9]">Send Test Event</h3>
        <button
          onClick={onClose}
          className="text-xs text-[#94A3B8] hover:text-[#F1F5F9]"
        >
          Close
        </button>
      </div>

      <div className="mt-4 space-y-4 flex-1 overflow-y-auto">
        <div>
          <label className="text-xs font-medium text-[#94A3B8]">Event Type</label>
          <input
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="mt-1 w-full rounded border border-[#1E1E24] bg-[#18181B] px-3 py-2 text-xs text-[#F1F5F9] focus:outline-none focus:border-[#E11D48]"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-[#94A3B8]">JSON Payload</label>
          <textarea
            rows={8}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            className="mt-1 w-full rounded border border-[#1E1E24] bg-[#18181B] p-3 font-mono text-xs text-[#F1F5F9] focus:outline-none focus:border-[#E11D48]"
          />
        </div>

        <button
          onClick={handleSend}
          disabled={loading}
          className="w-full rounded bg-[#E11D48] py-2 text-xs font-medium text-white transition hover:bg-[#F43F5E] disabled:opacity-50 cursor-pointer"
        >
          {loading ? "Dispatching..." : "Dispatch Event"}
        </button>

        {response && (
          <div className="mt-4 rounded border border-[#1E1E24] bg-[#18181B] p-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span
                className={
                  response.status === 202 ? "text-emerald-400" : "text-rose-400"
                }
              >
                HTTP {response.status}
              </span>
              <span className="text-[#94A3B8]">{response.latency} ms</span>
            </div>
            <pre className="mt-2 overflow-x-auto text-[11px] font-mono text-[#E2E8F0]">
              {JSON.stringify(response.body, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
