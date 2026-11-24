"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Radio,
  Layers,
  Webhook,
  AlertOctagon,
  Key,
  Users,
  ChevronsUpDown,
  Plus,
  LogOut,
  Check,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | null;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface OrgItem {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "VIEWER";
  isCurrent: boolean;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [dlqCount, setDlqCount] = useState<number | null>(null);
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [currentOrg, setCurrentOrg] = useState<OrgItem | null>(null);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");

  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "v2.2.0";

  useEffect(() => {
    let active = true;
    async function fetchDlqBadge() {
      try {
        const res = await fetch("/api/v1/analytics/overview");
        if (res.ok) {
          const json = await res.json();
          if (active) {
            setDlqCount(json.kpis?.dlqCount?.value ?? json.kpis?.dlq_count?.current ?? 0);
          }
        }
      } catch {
        // Telemetry badge fallback
      }
    }

    async function fetchOrgs() {
      try {
        const res = await fetch("/api/v1/orgs");
        if (res.ok) {
          const json = await res.json();
          const list: OrgItem[] = json.data || json.orgs || [];
          if (active) {
            setOrgs(list);
            const activeOrg = list.find((o) => o.isCurrent) || list[0] || null;
            setCurrentOrg(activeOrg);
          }
        }
      } catch {
        // Fallback
      }
    }

    fetchDlqBadge();
    fetchOrgs();

    const interval = setInterval(fetchDlqBadge, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleSwitchOrg = async (orgId: string) => {
    try {
      const res = await fetch("/api/v1/orgs/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        setIsSwitcherOpen(false);
        window.location.reload();
      }
    } catch {
      // Failed to switch
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;

    try {
      const res = await fetch("/api/v1/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newOrgName.trim() }),
      });
      if (res.ok) {
        setIsCreatingOrg(false);
        setNewOrgName("");
        setIsSwitcherOpen(false);
        window.location.reload();
      }
    } catch {
      // Creation failure
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch("/api/v1/auth/signout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  const navGroups: NavGroup[] = [
    {
      label: "Observability",
      items: [
        { href: "/dashboard", label: "Overview", icon: <LayoutDashboard size={16} /> },
        { href: "/dashboard/live", label: "Live Tail", icon: <Radio size={16} /> },
        { href: "/dashboard/events", label: "Events Stream", icon: <Layers size={16} /> },
      ],
    },
    {
      label: "Delivery Engine",
      items: [
        { href: "/dashboard/webhooks", label: "Webhook Endpoints", icon: <Webhook size={16} /> },
        {
          href: "/dashboard/dlq",
          label: "Dead Letter Queue",
          icon: <AlertOctagon size={16} />,
          badge: dlqCount && dlqCount > 0 ? dlqCount : null,
        },
      ],
    },
    {
      label: "Access & Security",
      items: [
        { href: "/dashboard/settings/keys", label: "API Keys", icon: <Key size={16} /> },
        { href: "/dashboard/settings/keys#team", label: "Team & RBAC", icon: <Users size={16} /> },
      ],
    },
  ];

  return (
    <aside className="fixed top-0 left-0 bottom-0 w-sidebar bg-surface border-r border-hairline-subtle z-shell flex flex-col justify-between select-none">
      <div className="flex flex-col">
        {/* Dynamic Org Switcher Header (48px) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsSwitcherOpen((prev) => !prev)}
            className="w-full h-topbar px-3 border-b border-hairline-subtle flex items-center justify-between hover:bg-elevated/40 transition-colors text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded bg-accent flex items-center justify-center text-white font-mono font-bold text-[11px] shrink-0 uppercase">
                {currentOrg?.slug?.charAt(0) || "W"}
              </div>
              <span className="type-section truncate text-ink">
                {currentOrg?.slug || "workspace"}
              </span>
              <Badge variant="accent" className="text-[10px] py-0 px-1.5 h-4 uppercase">
                {currentOrg?.role || "OWNER"}
              </Badge>
            </div>
            <ChevronsUpDown size={14} className="text-ink-3 shrink-0 ml-1" />
          </button>

          {/* Org Switcher Menu Dropdown */}
          {isSwitcherOpen && (
            <div className="absolute top-12 left-2 right-2 z-50 bg-[#0F0F12] border border-[#1E1E24] shadow-2xl p-2 rounded-md space-y-2">
              <div className="type-micro uppercase px-2 text-[#94A3B8] font-mono">
                Organizations
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {orgs.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => handleSwitchOrg(o.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors ${
                      o.id === currentOrg?.id
                        ? "bg-[#E11D48]/15 text-[#F1F5F9] font-medium"
                        : "text-[#94A3B8] hover:bg-[#18181B] hover:text-[#F1F5F9]"
                    }`}
                  >
                    <div className="truncate text-left">
                      <div className="truncate font-mono">{o.slug}</div>
                      <div className="text-[10px] text-[#94A3B8]">{o.name}</div>
                    </div>
                    {o.id === currentOrg?.id && (
                      <Check className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
                    )}
                  </button>
                ))}
              </div>

              {isCreatingOrg ? (
                <form onSubmit={handleCreateOrg} className="border-t border-[#1E1E24] pt-2 space-y-2">
                  <input
                    type="text"
                    required
                    placeholder="Workspace Name"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    className="w-full bg-[#18181B] border border-[#1E1E24] px-2 py-1 text-xs text-[#F1F5F9] rounded focus:outline-none focus:border-[#E11D48]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="flex-1 bg-[#E11D48] text-white text-xs py-1 rounded font-medium hover:bg-[#F43F5E]"
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingOrg(false)}
                      className="px-2 bg-[#18181B] text-[#94A3B8] text-xs py-1 rounded hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setIsCreatingOrg(true)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-[#18181B] transition-colors border-t border-[#1E1E24]"
                >
                  <Plus className="w-3.5 h-3.5 text-[#E11D48]" />
                  <span>Create Workspace</span>
                </button>
              )}

              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-[#F43F5E] hover:bg-[#E11D48]/10 transition-colors border-t border-[#1E1E24]"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
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
        <span>{appVersion}</span>
      </div>
    </aside>
  );
}
