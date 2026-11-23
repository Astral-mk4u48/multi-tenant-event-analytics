"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Radio,
  ListTree,
  Webhook,
  ScrollText,
  Inbox,
  Key,
  Users,
  ChevronsUpDown,
} from "lucide-react";
import { Badge } from "../ui/Badge";

export function Sidebar() {
  const pathname = usePathname();
  const [dlqCount, setDlqCount] = useState<number>(0);

  useEffect(() => {
    // Fetch initial DLQ count
    fetch("/api/v1/analytics/overview?range=24h")
      .then((res) => res.json())
      .then((data) => {
        if (data?.kpis?.dlqCount?.value !== undefined) {
          setDlqCount(data.kpis.dlqCount.value);
        }
      })
      .catch(() => {});
  }, []);

  const navGroups = [
    {
      label: "OBSERVABILITY",
      items: [
        { href: "/dashboard", label: "Overview", icon: <Activity size={16} /> },
        { href: "/dashboard/live", label: "Live Tail", icon: <Radio size={16} /> },
        { href: "/dashboard/events", label: "Events", icon: <ListTree size={16} /> },
      ],
    },
    {
      label: "DELIVERY",
      items: [
        { href: "/dashboard/webhooks", label: "Webhooks", icon: <Webhook size={16} /> },
        { href: "/dashboard/webhooks#logs", label: "Delivery Logs", icon: <ScrollText size={16} /> },
        {
          href: "/dashboard/dlq",
          label: "Dead Letter Queue",
          icon: <Inbox size={16} />,
          badge: dlqCount > 0 ? dlqCount : null,
        },
      ],
    },
    {
      label: "ACCESS",
      items: [
        { href: "/dashboard/settings/keys", label: "API Keys", icon: <Key size={16} /> },
        { href: "/dashboard/settings/keys#team", label: "Team & RBAC", icon: <Users size={16} /> },
      ],
    },
  ];

  return (
    <aside className="fixed top-0 left-0 bottom-0 w-sidebar bg-surface border-r border-hairline-subtle z-shell flex flex-col justify-between select-none">
      <div className="flex flex-col">
        {/* Org Switcher Header (48px) */}
        <div className="h-topbar px-3 border-b border-hairline-subtle flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {/* 20px square mark (4px radius) */}
            <div className="w-5 h-5 rounded bg-accent flex items-center justify-center text-white font-mono font-bold text-[11px] shrink-0">
              A
            </div>
            <span className="type-section truncate text-ink">acme-prod</span>
            <Badge variant="accent" className="text-[10px] py-0 px-1.5 h-4">
              OWNER
            </Badge>
          </div>
          <ChevronsUpDown size={14} className="text-ink-3 shrink-0" />
        </div>

        {/* Nav Groups */}
        <div className="py-2 space-y-4">
          {navGroups.map((group, gIdx) => (
            <div key={group.label} className={gIdx > 0 ? "pt-2 border-t border-hairline-subtle" : ""}>
              <div className="type-micro uppercase px-3 mb-1 text-ink-3">
                {group.label}
              </div>
              <nav className="space-y-0.5 px-2">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`h-[32px] px-2.5 rounded flex items-center justify-between text-[13px] transition-colors duration-150 ${
                        isActive
                          ? "bg-accent-subtle text-ink font-medium"
                          : "text-ink-2 hover:bg-elevated hover:text-ink"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={isActive ? "text-accent" : "text-ink-3"}>
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </div>
                      {item.badge !== null && item.badge !== undefined && (
                        <span className="badge badge-error h-4 px-1 text-[10px] mono-data">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </div>

      {/* Operational Footer (36px) */}
      <div className="h-[36px] px-3 border-t border-hairline-subtle flex items-center justify-between text-[11px] mono-data text-ink-3">
        <div className="flex items-center gap-2">
          <span className="status-dot-live" />
          <span className="text-ink-2">API: Operational</span>
        </div>
        <span>v1.0.0</span>
      </div>
    </aside>
  );
}
