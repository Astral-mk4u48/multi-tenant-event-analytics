"use client";

import React, { useState } from "react";
import { X, Send, Check } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export function SendTestEventModal({
  isOpen,
  onClose,
  onSent,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [eventName, setEventName] = useState("payment.completed");
  const [amount, setAmount] = useState("49.99");
  const [isLoading, setIsLoading] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessId(null);

    try {
      // In dev mode, we use acme-prod apiKey or session
      const res = await fetch("/api/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Fallback demo API key or bearer
          Authorization: "Bearer pk_live_8f2a1b3c4d5e",
        },
        body: JSON.stringify({
          event: eventName.trim(),
          data: {
            amount: parseFloat(amount) || 0,
            currency: "USD",
            customer_id: "cus_demo_48",
            timestamp: new Date().toISOString(),
          },
        }),
      });

      if (res.status === 202) {
        const json = await res.json();
        setSuccessId(json.id);
        if (onSent) onSent();
        setTimeout(() => {
          onClose();
          setSuccessId(null);
        }, 1200);
      } else {
        const json = await res.json().catch(() => ({}));
        setErrorMsg(json.error || `HTTP ${res.status}`);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to send event");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-modal flex items-center justify-center p-4"
    >
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-[480px] max-w-full bg-surface border border-hairline rounded-md p-6 z-10 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="type-section text-ink">Send test event</h2>
            <p className="text-[12px] text-ink-2 mt-0.5">
              POST /v1/events · High-throughput ingestion boundary
            </p>
          </div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink p-1">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className="type-micro uppercase text-ink-3 block mb-1">Event Name</label>
            <Input
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. payment.completed"
              required
            />
          </div>

          <div>
            <label className="type-micro uppercase text-ink-3 block mb-1">Amount ($)</label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="49.99"
              required
            />
          </div>

          {successId && (
            <div className="p-2 border border-status-success/30 bg-status-success/10 text-status-success text-[12px] mono-data rounded flex items-center gap-2">
              <Check size={14} /> Accepted: {successId}
            </div>
          )}

          {errorMsg && (
            <div className="p-2 border border-status-error/30 bg-status-error/10 text-status-error text-[12px] mono-data rounded">
              {errorMsg}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              isLoading={isLoading}
              icon={<Send size={14} />}
            >
              Send Event
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
