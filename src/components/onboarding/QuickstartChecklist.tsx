"use client";

import React, { useState, useEffect } from "react";
import { Key, Webhook, Send, CheckCircle2, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

export function QuickstartChecklist({
  onOpenTestEvent,
}: {
  onOpenTestEvent: () => void;
}) {
  const router = useRouter();
  const [hasKeys, setHasKeys] = useState(false);
  const [hasEndpoints, setHasEndpoints] = useState(false);
  const [hasEvents, setHasEvents] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkSetupStatus() {
      try {
        const [keysRes, epsRes, eventsRes] = await Promise.all([
          fetch("/api/v1/keys"),
          fetch("/api/v1/webhooks"),
          fetch("/api/v1/analytics/overview"),
        ]);

        if (keysRes.ok) {
          const json = await keysRes.json();
          setHasKeys((json.keys || json.data || []).length > 0);
        }
        if (epsRes.ok) {
          const json = await epsRes.json();
          setHasEndpoints((json.endpoints || json.data || []).length > 0);
        }
        if (eventsRes.ok) {
          const json = await eventsRes.json();
          const count = json.kpis?.eventsIngested?.value ?? json.kpis?.events_ingested?.current ?? 0;
          setHasEvents(count > 0);
        }
      } catch {
        // Silently ignore — not critical
      } finally {
        setLoading(false);
      }
    }

    checkSetupStatus();
  }, []);

  // Dismiss banner once the workspace has ingested its first event
  if (loading || hasEvents) return null;

  const completedCount = [hasKeys, hasEndpoints, hasEvents].filter(Boolean).length;

  return (
    <div className="border border-hairline-subtle bg-surface p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-mono text-xs font-semibold text-ink-3 tracking-wider uppercase">
            Setup
          </div>
          <h2 className="text-base font-semibold text-ink mt-1">
            Get your workspace ready
          </h2>
        </div>
        <div className="text-xs font-mono text-ink-3">
          {completedCount} / 3
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Step 1: Ingestion Key */}
        <div
          onClick={() => router.push("/dashboard/settings/keys")}
          className={`p-4 border cursor-pointer transition-colors duration-150 ${
            hasKeys
              ? "border-status-success/40 bg-status-success/5"
              : "border-hairline-subtle bg-elevated hover:border-accent/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className={`w-4 h-4 ${hasKeys ? "text-status-success" : "text-accent"}`} />
              <span className="text-xs font-semibold text-ink">Create ingestion key</span>
            </div>
            {hasKeys ? (
              <CheckCircle2 className="w-4 h-4 text-status-success" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5 text-ink-3" />
            )}
          </div>
          <p className="text-xs text-ink-2 mt-2 leading-relaxed">
            Generate a scoped API key to authorize event ingestion from your services.
          </p>
        </div>

        {/* Step 2: Register Endpoint */}
        <div
          onClick={() => router.push("/dashboard/webhooks")}
          className={`p-4 border cursor-pointer transition-colors duration-150 ${
            hasEndpoints
              ? "border-status-success/40 bg-status-success/5"
              : "border-hairline-subtle bg-elevated hover:border-accent/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Webhook className={`w-4 h-4 ${hasEndpoints ? "text-status-success" : "text-accent"}`} />
              <span className="text-xs font-semibold text-ink">Register endpoint</span>
            </div>
            {hasEndpoints ? (
              <CheckCircle2 className="w-4 h-4 text-status-success" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5 text-ink-3" />
            )}
          </div>
          <p className="text-xs text-ink-2 mt-2 leading-relaxed">
            Configure a destination URL and event filter patterns for outbound delivery.
          </p>
        </div>

        {/* Step 3: Send First Event */}
        <div
          onClick={onOpenTestEvent}
          className={`p-4 border cursor-pointer transition-colors duration-150 ${
            hasEvents
              ? "border-status-success/40 bg-status-success/5"
              : "border-hairline-subtle bg-elevated hover:border-accent/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className={`w-4 h-4 ${hasEvents ? "text-status-success" : "text-accent"}`} />
              <span className="text-xs font-semibold text-ink">Send a test event</span>
            </div>
            {hasEvents ? (
              <CheckCircle2 className="w-4 h-4 text-status-success" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5 text-ink-3" />
            )}
          </div>
          <p className="text-xs text-ink-2 mt-2 leading-relaxed">
            Dispatch a test payload from the in-browser drawer to verify live routing.
          </p>
        </div>
      </div>
    </div>
  );
}
