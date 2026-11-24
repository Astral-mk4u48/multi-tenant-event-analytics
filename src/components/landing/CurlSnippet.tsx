"use client";

import React, { useState } from "react";

export function CurlSnippet() {
  const [copied, setCopied] = useState(false);

  const snippet = `curl -X POST https://multi-tenant-event-analytics.vercel.app/api/v1/events \\
  -H "Authorization: Bearer pk_live_sample" \\
  -H "Content-Type: application/json" \\
  -d '{
    "event": "payment.succeeded",
    "payload": {
      "customer_id": "cus_92f8a1",
      "amount_cents": 14900,
      "currency": "usd"
    }
  }'`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API restricted
    }
  };

  return (
    <div className="border border-hairline bg-surface overflow-hidden font-mono text-xs">
      <div className="h-9 bg-elevated border-b border-hairline px-3.5 flex items-center justify-between">
        <span className="text-[11px] text-ink-3 uppercase tracking-wider">
          Ingest Quickstart (HTTP / REST)
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy curl command"
          className="text-[11px] text-ink-2 hover:text-ink transition-colors px-2 py-1 border border-hairline bg-surface hover:bg-elevated flex items-center gap-1.5"
        >
          {copied ? (
            <span className="text-emerald font-semibold">Copied!</span>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-4 overflow-x-auto text-ink bg-canvas/80 leading-relaxed">
        <pre className="text-ink-2">
          <span className="text-accent font-semibold">curl</span> -X POST https://multi-tenant-event-analytics.vercel.app/api/v1/events \{"\n"}
          {"  "}-H <span className="text-emerald">&quot;Authorization: Bearer pk_live_sample&quot;</span> \{"\n"}
          {"  "}-H <span className="text-emerald">&quot;Content-Type: application/json&quot;</span> \{"\n"}
          {"  "}-d <span className="text-ink">&#39;&#123;</span>{"\n"}
          {"    "}<span className="text-ink">&quot;event&quot;</span>: <span className="text-emerald">&quot;payment.succeeded&quot;</span>,{"\n"}
          {"    "}<span className="text-ink">&quot;payload&quot;</span>: &#123;{"\n"}
          {"      "}<span className="text-ink">&quot;customer_id&quot;</span>: <span className="text-emerald">&quot;cus_92f8a1&quot;</span>,{"\n"}
          {"      "}<span className="text-ink">&quot;amount_cents&quot;</span>: <span className="text-amber">14900</span>,{"\n"}
          {"      "}<span className="text-ink">&quot;currency&quot;</span>: <span className="text-emerald">&quot;usd&quot;</span>{"\n"}
          {"    "}&#125;{"\n"}
          {"  "}&#125;&#39;
        </pre>
      </div>
    </div>
  );
}
