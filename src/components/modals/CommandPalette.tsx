"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Activity, Radio, Key, Inbox, Send, Copy, Check } from "lucide-react";

export function CommandPalette({
  isOpen,
  onClose,
  onOpenTestEvent,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenTestEvent: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const navigateTo = (path: string) => {
    router.push(path);
    onClose();
  };

  const copyOrgSlug = () => {
    navigator.clipboard.writeText("acme-prod");
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onClose();
    }, 800);
  };

  const commands = [
    {
      id: "overview",
      label: "Go to Overview",
      shortcut: "G O",
      icon: <Activity size={14} />,
      action: () => navigateTo("/dashboard"),
    },
    {
      id: "live",
      label: "Go to Live Tail",
      shortcut: "G L",
      icon: <Radio size={14} />,
      action: () => navigateTo("/dashboard/live"),
    },
    {
      id: "webhooks",
      label: "Go to Webhooks & Delivery Logs",
      shortcut: "G W",
      icon: <Send size={14} />,
      action: () => navigateTo("/dashboard/webhooks"),
    },
    {
      id: "dlq",
      label: "Go to Dead Letter Queue",
      shortcut: "G D",
      icon: <Inbox size={14} />,
      action: () => navigateTo("/dashboard/dlq"),
    },
    {
      id: "keys",
      label: "Go to API Keys & RBAC",
      shortcut: "G K",
      icon: <Key size={14} />,
      action: () => navigateTo("/dashboard/settings/keys"),
    },
    {
      id: "test_event",
      label: "Send Test Event",
      shortcut: "T",
      icon: <Send size={14} />,
      action: () => {
        onClose();
        onOpenTestEvent();
      },
    },
    {
      id: "copy_org",
      label: copied ? "Copied acme-prod" : "Copy Active Org Slug (acme-prod)",
      shortcut: "C",
      icon: copied ? <Check size={14} className="text-status-success" /> : <Copy size={14} />,
      action: copyOrgSlug,
    },
  ];

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-modal flex items-start justify-center pt-24 p-4"
    >
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-[480px] max-w-full bg-surface border border-hairline rounded-md overflow-hidden z-10 flex flex-col">
        <div className="flex items-center px-3 border-b border-hairline bg-surface">
          <Search size={14} className="text-ink-3 shrink-0 mr-2" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or jump to page..."
            className="w-full h-10 bg-transparent text-ink text-[13px] placeholder:text-ink-3 focus:outline-none"
          />
          <span className="kbd text-[10px]">Esc</span>
        </div>

        <div className="max-h-72 overflow-y-auto scrollbar-dark p-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-ink-3 text-[12px]">
              No matching commands
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                onClick={item.action}
                className="w-full flex items-center justify-between px-3 py-2 text-[13px] rounded hover:bg-elevated text-ink-2 hover:text-ink transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-ink-3">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.shortcut && (
                  <span className="kbd text-[10px]">{item.shortcut}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
