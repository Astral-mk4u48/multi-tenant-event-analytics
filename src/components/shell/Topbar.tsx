"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Plus, Send } from "lucide-react";
import { Button } from "../ui/Button";

export function Topbar({
  onOpenCommandPalette,
  onOpenTestEvent,
}: {
  onOpenCommandPalette: () => void;
  onOpenTestEvent: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentRange = searchParams.get("range") || "24h";

  const getBreadcrumbs = () => {
    if (pathname.includes("/live")) return ["Observability", "Live Tail"];
    if (pathname.includes("/events")) return ["Observability", "Events"];
    if (pathname.includes("/webhooks")) return ["Delivery", "Webhooks"];
    if (pathname.includes("/dlq")) return ["Delivery", "Dead Letter Queue"];
    if (pathname.includes("/settings/keys")) return ["Access", "API Keys & RBAC"];
    return ["Observability", "Overview"];
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
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[13px]">
        <span className="text-ink-2 font-mono text-[12px]">acme-prod</span>
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
                  : "text-ink-3 hover:text-ink"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Search Affordance */}
        <button
          onClick={onOpenCommandPalette}
          className="h-[32px] px-2.5 rounded bg-surface border border-hairline hover:border-hairline-strong text-ink-3 hover:text-ink flex items-center gap-2 text-[12px] transition-colors cursor-pointer"
        >
          <Search size={14} />
          <span>Search...</span>
          <span className="kbd text-[10px]">⌘K</span>
        </button>

        {/* View-contextual Primary CTA */}
        {isLiveOrEvents ? (
          <Button
            variant="primary"
            size="default"
            icon={<Send size={14} />}
            onClick={onOpenTestEvent}
          >
            Send Test Event
          </Button>
        ) : (
          <Button
            variant="primary"
            size="default"
            icon={<Plus size={14} />}
            onClick={() => {
              if (pathname.includes("/webhooks")) {
                const el = document.getElementById("new-endpoint-btn");
                if (el) el.click();
              } else {
                router.push("/dashboard/webhooks");
              }
            }}
          >
            New Endpoint
          </Button>
        )}
      </div>
    </header>
  );
}
