"use client";

import React, { useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Send, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface TopbarProps {
  onOpenCommandPalette: () => void;
  onOpenTestEvent: () => void;
}

export function Topbar({ onOpenCommandPalette, onOpenTestEvent }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentRange = searchParams.get("range") || "24h";
  const [orgSlug, setOrgSlug] = useState("workspace");

  useEffect(() => {
    async function loadOrg() {
      try {
        const res = await fetch("/api/v1/orgs");
        if (res.ok) {
          const json = await res.json();
          const orgs = json.data || json.orgs || [];
          const current = orgs.find((o: { isCurrent: boolean }) => o.isCurrent) || orgs[0];
          if (current?.slug) setOrgSlug(current.slug);
        }
      } catch {
        // Fallback
      }
    }
    loadOrg();
  }, []);

  // Compute breadcrumbs
  const getBreadcrumbs = () => {
    if (pathname === "/dashboard") return ["Platform", "Overview"];
    if (pathname.includes("/live")) return ["Observability", "Live Tail"];
    if (pathname.includes("/events")) return ["Observability", "Events Stream"];
    if (pathname.includes("/webhooks")) return ["Delivery", "Webhook Endpoints"];
    if (pathname.includes("/dlq")) return ["Delivery", "Dead Letter Queue"];
    if (pathname.includes("/settings/keys")) return ["Access", "API Keys & RBAC"];
    return ["Platform", "Dashboard"];
  };

  const breadcrumbs = getBreadcrumbs();

  const handleRangeChange = (range: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);
    router.push(`${pathname}?${params.toString()}`);
  };

  const isLiveOrEvents = pathname.includes("/live") || pathname.includes("/events");

  return (
    <header className="fixed top-0 left-sidebar right-0 h-topbar bg-canvas border-b border-hairline-subtle z-shell px-6 flex items-center justify-between select-none">
      {/* Breadcrumb with dynamic org slug */}
      <div className="flex items-center gap-1.5 text-[13px]">
        <span className="text-ink-2 font-mono text-[12px]">{orgSlug}</span>
        <span className="text-ink-3">/</span>
        <span className="text-ink-2">{breadcrumbs[0]}</span>
        <span className="text-ink-3">/</span>
        <span className="text-ink font-medium">{breadcrumbs[1]}</span>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Segmented Range Control */}
        <div className="inline-flex items-center p-0.5 rounded bg-surface border border-hairline-subtle text-[11px] mono-data">
          {(["1h", "24h", "7d", "30d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => handleRangeChange(r)}
              className={`px-2 py-0.5 rounded-xs transition-colors cursor-pointer ${
                currentRange === r
                  ? "bg-elevated text-ink font-medium"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* ⌘K Trigger */}
        <button
          onClick={onOpenCommandPalette}
          className="h-7 px-2.5 rounded bg-surface border border-hairline-subtle flex items-center gap-2 text-ink-3 hover:text-ink hover:border-hairline-strong transition-colors cursor-pointer text-xs"
        >
          <Search size={13} />
          <span className="text-[12px]">Search or jump to...</span>
          <kbd className="kbd text-[10px]">⌘K</kbd>
        </button>

        {/* Primary CTA */}
        {isLiveOrEvents ? (
          <Button
            variant="primary"
            size="sm"
            onClick={onOpenTestEvent}
            className="flex items-center gap-1.5 h-7"
          >
            <Send size={13} />
            <span>Send Test Event</span>
          </Button>
        ) : pathname.includes("/webhooks") ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              const addBtn = document.getElementById("add-endpoint-btn");
              if (addBtn) addBtn.click();
            }}
            className="flex items-center gap-1.5 h-7"
          >
            <Plus size={13} />
            <span>New Endpoint</span>
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={onOpenTestEvent}
            className="flex items-center gap-1.5 h-7"
          >
            <Send size={13} />
            <span>Send Event</span>
          </Button>
        )}
      </div>
    </header>
  );
}
