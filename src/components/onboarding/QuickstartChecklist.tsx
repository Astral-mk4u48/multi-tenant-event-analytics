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
    async function checkMilestones() {
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
        // Fallback
      } finally {
        setLoading(false);
      }
    }

    checkMilestones();
  }, []);

  // Hide banner once the organization has ingested its first event
  if (loading || hasEvents) return null;

  return (
    <div className="rounded-md border border-[#1E1E24] bg-[#0F0F12] p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-mono text-xs font-semibold text-[#E11D48] tracking-wider uppercase">
            Quickstart Onboarding Checklist
          </div>
          <h2 className="text-base font-semibold text-[#F1F5F9] mt-1">
            Configure your workspace in 3 simple steps
          </h2>
        </div>
        <div className="text-xs font-mono text-[#94A3B8]">
          {[hasKeys, hasEndpoints, hasEvents].filter(Boolean).length} / 3 Completed
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Step 1: Ingestion Key */}
        <div
          onClick={() => router.push("/dashboard/settings/keys")}
          className={`p-4 rounded border cursor-pointer transition-all ${
            hasKeys
              ? "border-[#10B981]/40 bg-[#10B981]/5"
              : "border-[#1E1E24] bg-[#18181B] hover:border-[#E11D48]/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className={`w-4 h-4 ${hasKeys ? "text-[#10B981]" : "text-[#E11D48]"}`} />
              <span className="text-xs font-semibold text-[#F1F5F9]">1. Create Ingestion Key</span>
            </div>
            {hasKeys ? (
              <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8]" />
            )}
          </div>
          <p className="text-xs text-[#94A3B8] mt-2">
            Generate a scoped `pk_live_...` key to authorize high-throughput event ingestion.
          </p>
        </div>

        {/* Step 2: Register Endpoint */}
        <div
          onClick={() => router.push("/dashboard/webhooks")}
          className={`p-4 rounded border cursor-pointer transition-all ${
            hasEndpoints
              ? "border-[#10B981]/40 bg-[#10B981]/5"
              : "border-[#1E1E24] bg-[#18181B] hover:border-[#E11D48]/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Webhook className={`w-4 h-4 ${hasEndpoints ? "text-[#10B981]" : "text-[#E11D48]"}`} />
              <span className="text-xs font-semibold text-[#F1F5F9]">2. Register Webhook</span>
            </div>
            {hasEndpoints ? (
              <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8]" />
            )}
          </div>
          <p className="text-xs text-[#94A3B8] mt-2">
            Configure destination URL and event filter patterns to receive outbound dispatches.
          </p>
        </div>

        {/* Step 3: Send First Event */}
        <div
          onClick={onOpenTestEvent}
          className={`p-4 rounded border cursor-pointer transition-all ${
            hasEvents
              ? "border-[#10B981]/40 bg-[#10B981]/5"
              : "border-[#1E1E24] bg-[#18181B] hover:border-[#E11D48]/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Send className={`w-4 h-4 ${hasEvents ? "text-[#10B981]" : "text-[#E11D48]"}`} />
              <span className="text-xs font-semibold text-[#F1F5F9]">3. Send First Event</span>
            </div>
            {hasEvents ? (
              <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8]" />
            )}
          </div>
          <p className="text-xs text-[#94A3B8] mt-2">
            Dispatch a simulated test payload from the interactive drawer to verify live routing.
          </p>
        </div>
      </div>
    </div>
  );
}
