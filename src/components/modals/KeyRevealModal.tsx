"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle, Copy, Check, X } from "lucide-react";
import { Button } from "../ui/Button";

export interface KeyRevealModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawKey?: string;
  apiKey?: string;
  keyName: string;
  scope?: string;
}

export function KeyRevealModal({
  isOpen,
  onClose,
  rawKey,
  apiKey,
  keyName,
  scope = "INGEST",
}: KeyRevealModalProps) {
  const secretKey = rawKey || apiKey || "";
  const [copied, setCopied] = useState(false);
  const [canConfirm, setCanConfirm] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCopied(false);
      setCanConfirm(false);
      // Automatically enable confirm after 3 seconds
      const timer = setTimeout(() => {
        setCanConfirm(true);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleCopy = () => {
    navigator.clipboard.writeText(secretKey);
    setCopied(true);
    setCanConfirm(true);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-modal flex items-center justify-center p-4"
    >
      {/* Scrim (z 49, no blur) */}
      <div
        className="fixed inset-0 bg-black/60 transition-opacity"
        onClick={() => {
          if (confirm("Close without copying? The key cannot be recovered.")) {
            onClose();
          }
        }}
      />

      {/* Modal Dialog (480px) */}
      <div className="relative w-[480px] max-w-full bg-surface border border-hairline p-6 z-10 flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="type-section text-ink">API key created</h2>
            <p className="text-[12px] mono-data text-ink-2 mt-0.5">
              {keyName} · Scope: {scope}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink transition-colors p-1"
          >
            <X size={16} />
          </button>
        </div>

        {/* Inset Selectable Key Box (#050507) */}
        <div className="bg-inset border border-hairline p-3 flex items-center justify-between gap-2">
          <span className="mono-data text-ink text-[12px] truncate select-all">
            {secretKey}
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={copied ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
            onClick={handleCopy}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        {/* Amber 1px Warning Banner */}
        <div className="border border-amber/35 bg-amber-subtle p-3 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-amber shrink-0 mt-0.5" />
          <div className="text-[12px] leading-[18px] text-ink">
            <span className="font-semibold text-amber">This key will only be shown once.</span>
            <br />
            Only its SHA-256 hash is stored. If lost, you must create a new one.
          </div>
        </div>

        {/* Action button disabled until copied or 3s */}
        <div className="flex justify-end pt-2">
          <Button
            variant="primary"
            disabled={!canConfirm}
            onClick={onClose}
          >
            I have saved the key
          </Button>
        </div>
      </div>
    </div>
  );
}
