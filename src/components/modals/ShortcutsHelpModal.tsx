"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

export function ShortcutsHelpModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
  }) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const shortcuts = [
    { key: "Cmd/Ctrl + K", desc: "Open Command Palette" },
    { key: "/", desc: "Focus search / filter input" },
    { key: "?", desc: "Show keyboard shortcuts" },
    { key: "T", desc: "Open Send Test Event dialog" },
    { key: "G O", desc: "Navigate to Overview" },
    { key: "G L", desc: "Navigate to Live Tail" },
    { key: "G E", desc: "Navigate to Ingested Events" },
    { key: "G W", desc: "Navigate to Webhook Endpoints" },
    { key: "G D", desc: "Navigate to Dead Letter Queue" },
    { key: "G K", desc: "Navigate to API Keys & RBAC" },
    { key: "Esc", desc: "Close drawer / modal / palette" },
  ];

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/80">
      <div className="bg-surface border border-hairline max-w-md w-full p-6 space-y-4 font-mono text-xs shadow-2xl">
        <div className="flex items-center justify-between border-b border-hairline-subtle pb-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-accent inline-block" />
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wider">
              Keyboard Shortcuts
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink transition-colors"
            aria-label="Close shortcuts modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2 max-h-[380px] overflow-y-auto">
          {shortcuts.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between py-1.5 px-2 border border-hairline-subtle bg-canvas/40"
            >
              <span className="text-ink-2 font-sans">{s.desc}</span>
              <kbd className="px-2 py-0.5 bg-elevated border border-hairline text-ink font-mono text-[11px] font-semibold">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="border-t border-hairline-subtle pt-3 text-right">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 bg-elevated hover:bg-elevated/80 border border-hairline text-ink"
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
