"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertTriangle,
  RotateCw,
  Trash2,
  Eye,
  CheckSquare,
  Square,
  MinusSquare,
  AlertOctagon,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useDrawer } from "@/components/drawer/DrawerContext";

interface DlqDelivery {
  id: string;
  event_id: string;
  endpoint_id: string;
  endpoint_url: string;
  event_name: string;
  state: "DLQ";
  attempt_count: number;
  max_attempts: number;
  last_status_code: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export default function DlqPage() {
  const { openDrawer } = useDrawer();

  const [deliveries, setDeliveries] = useState<DlqDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeRowIndex, setActiveRowIndex] = useState(0);

  // Bulk actions state
  const [isReplayingBulk, setIsReplayingBulk] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  const [replayingSingleId, setReplayingSingleId] = useState<string | null>(null);

  const fetchDlq = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/deliveries?state=DLQ&limit=50");
      if (res.ok) {
        const json = await res.json();
        setDeliveries(json.data || []);
        setSelectedIds(new Set());
      }
    } catch (err) {
      console.error("Failed to load DLQ deliveries", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDlq();
  }, [fetchDlq]);

  // Master checkbox status
  const allSelected = deliveries.length > 0 && selectedIds.size === deliveries.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < deliveries.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(deliveries.map((d) => d.id)));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Bulk Replay
  const handleBulkReplay = async () => {
    if (selectedIds.size === 0) return;
    try {
      setIsReplayingBulk(true);
      const res = await fetch("/api/v1/dlq/replay-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery_ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        fetchDlq();
      }
    } catch (err) {
      console.error("Bulk replay failed", err);
    } finally {
      setIsReplayingBulk(false);
    }
  };

  // Bulk Purge
  const handlePurge = async () => {
    try {
      setIsPurging(true);
      const res = await fetch("/api/v1/dlq/purge", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery_ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        setIsPurgeModalOpen(false);
        fetchDlq();
      }
    } catch (err) {
      console.error("Purge failed", err);
    } finally {
      setIsPurging(false);
    }
  };

  // Single Replay
  const handleSingleReplay = async (id: string) => {
    try {
      setReplayingSingleId(id);
      const res = await fetch(`/api/v1/deliveries/${id}/replay`, {
        method: "POST",
      });
      if (res.ok) {
        fetchDlq();
      }
    } catch (err) {
      console.error("Replay failed", err);
    } finally {
      setReplayingSingleId(null);
    }
  };

  // Keyboard navigation for J/K/X/Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
      if (isInput || deliveries.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setActiveRowIndex((idx) => Math.min(deliveries.length - 1, idx + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveRowIndex((idx) => Math.max(0, idx - 1));
      } else if (e.key === "x") {
        e.preventDefault();
        const activeItem = deliveries[activeRowIndex];
        if (activeItem) toggleSelectRow(activeItem.id);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const activeItem = deliveries[activeRowIndex];
        if (activeItem) openDrawer(activeItem.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deliveries, activeRowIndex, openDrawer]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="type-page-title text-ink">Dead Letter Queue</h1>
            <Badge variant="crimson">{deliveries.length} Failed</Badge>
          </div>
          <p className="type-body text-ink-3 mt-1">
            Deliveries that exceeded max attempts (5) requiring manual triage or replay
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchDlq}
            disabled={loading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="type-micro">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Tri-state Table Container */}
      <div className="bg-surface border border-hairline-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-hairline-subtle h-9 text-ink-3 type-label bg-surface">
                {/* Tri-state Checkbox Header */}
                <th className="font-normal px-4 w-10 text-center">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-ink hover:text-ink-2 p-1"
                    title={allSelected ? "Deselect All" : "Select All"}
                  >
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4 text-crimson" />
                    ) : someSelected ? (
                      <MinusSquare className="w-4 h-4 text-crimson" />
                    ) : (
                      <Square className="w-4 h-4 text-ink-3" />
                    )}
                  </button>
                </th>
                <th className="font-normal px-4">Event Type</th>
                <th className="font-normal px-4">Destination Endpoint</th>
                <th className="font-normal px-4">Attempts</th>
                <th className="font-normal px-4">Status / Last Error</th>
                <th className="font-normal px-4">Failed At (UTC)</th>
                <th className="font-normal px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-subtle">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-ink-3 type-micro mono-data">
                    Loading Dead Letter Queue...
                  </td>
                </tr>
              ) : deliveries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-ink-3 type-micro">
                    <AlertOctagon className="w-8 h-8 mx-auto mb-3 text-emerald opacity-60" />
                    <p className="type-heading text-ink">DLQ is Empty</p>
                    <p className="mt-1">All outbound webhook deliveries succeeded cleanly.</p>
                  </td>
                </tr>
              ) : (
                deliveries.map((item, index) => {
                  const isSelected = selectedIds.has(item.id);
                  const isFocused = index === activeRowIndex;

                  return (
                    <tr
                      key={item.id}
                      className={`h-11 transition-colors text-ink type-body cursor-pointer ${
                        isSelected
                          ? "bg-crimson-subtle/20"
                          : isFocused
                          ? "bg-elevated/60"
                          : "hover:bg-elevated/40"
                      }`}
                      onClick={() => toggleSelectRow(item.id)}
                    >
                      <td
                        className="px-4 text-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectRow(item.id);
                        }}
                      >
                        <button
                          type="button"
                          className="p-1 text-ink"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-crimson" />
                          ) : (
                            <Square className="w-4 h-4 text-ink-3" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 mono-data font-semibold text-ink truncate max-w-[180px]">
                        {item.event_name}
                      </td>
                      <td className="px-4 mono-data text-ink-2 truncate max-w-[240px]">
                        {item.endpoint_url}
                      </td>
                      <td className="px-4 mono-data text-crimson font-medium">
                        {item.attempt_count}/{item.max_attempts}
                      </td>
                      <td className="px-4 mono-data text-crimson truncate max-w-[220px]">
                        {item.last_error || `HTTP ${item.last_status_code}`}
                      </td>
                      <td className="px-4 mono-data text-ink-3 type-micro whitespace-nowrap">
                        {new Date(item.updated_at).toISOString().substring(0, 19).replace("T", " ")}
                      </td>
                      <td
                        className="px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDrawer(item.id)}
                            className="h-7 px-2.5 text-ink-2 hover:text-ink"
                          >
                            <Eye className="w-3.5 h-3.5 mr-1" />
                            <span>Inspect</span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleSingleReplay(item.id)}
                            disabled={replayingSingleId === item.id}
                            className="h-7 px-2.5 text-ink"
                          >
                            <RotateCw
                              className={`w-3.5 h-3.5 mr-1 ${
                                replayingSingleId === item.id ? "animate-spin" : ""
                              }`}
                            />
                            <span>Replay</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating Bulk Action Bar (when rows selected) */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-elevated border border-hairline-strong px-4 py-3 flex items-center gap-6 shadow-none">
          <div className="flex items-center gap-2 type-micro text-ink">
            <span className="w-2 h-2 rounded-full bg-crimson" />
            <span className="mono-data font-semibold">
              {selectedIds.size} {selectedIds.size === 1 ? "delivery" : "deliveries"} selected
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              onClick={handleBulkReplay}
              disabled={isReplayingBulk}
              className="flex items-center gap-1.5"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isReplayingBulk ? "animate-spin" : ""}`} />
              <span>Replay Selected</span>
            </Button>

            <Button
              variant="danger"
              size="sm"
              onClick={() => setIsPurgeModalOpen(true)}
              className="flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Purge Selected</span>
            </Button>

            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-ink-3 hover:text-ink type-micro mono-data"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* Purge Confirmation Modal */}
      {isPurgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="bg-elevated border border-hairline-strong max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-crimson">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="type-heading text-ink">Purge DLQ Deliveries?</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPurgeModalOpen(false)}
                className="text-ink-3 hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="type-body text-ink-2">
              This will permanently delete{" "}
              <strong className="text-ink mono-data">{selectedIds.size}</strong> failed webhook{" "}
              {selectedIds.size === 1 ? "delivery" : "deliveries"} from the Dead Letter Queue.
              This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3">
              <Button
                variant="ghost"
                onClick={() => setIsPurgeModalOpen(false)}
                disabled={isPurging}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handlePurge}
                disabled={isPurging}
              >
                {isPurging ? "Purging..." : "Confirm Purge"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
