"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Filter, RefreshCw, ChevronLeft, ChevronRight, Eye, X, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface IngestedEvent {
  id: string;
  eventName: string;
  idempotencyKey: string | null;
  payload: Record<string, unknown>;
  ingestLatencyMs: number;
  statusCode: number;
  createdAt: string;
}

export default function EventsPage() {
  const [events, setEvents] = useState<IngestedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<IngestedEvent | null>(null);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const fetchEvents = useCallback(async (cursor?: string | null) => {
    try {
      setLoading(true);
      let url = "/api/v1/events?limit=25";
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setEvents(json.data || []);
        setNextCursor(json.next_cursor || null);
      }
    } catch {
      // Gracefully handle network issues
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    setCursorHistory([]);
    setCurrentCursor(null);
    fetchEvents(null);
  }, [search, fetchEvents]);

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorHistory((prev) => [...prev, currentCursor || ""]);
    setCurrentCursor(nextCursor);
    fetchEvents(nextCursor);
  };

  const handlePrevious = () => {
    if (cursorHistory.length === 0) return;
    const prevCursor = cursorHistory[cursorHistory.length - 1];
    setCursorHistory((prev) => prev.slice(0, prev.length - 1));
    const targetCursor = prevCursor === "" ? null : prevCursor;
    setCurrentCursor(targetCursor);
    fetchEvents(targetCursor);
  };

  const handleCopyPayload = (payload: Record<string, unknown>) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="type-page-title text-ink">Ingested Events</h1>
          <p className="type-body text-ink-3 mt-1">
            Persisted event stream ingested through HTTP REST and batch endpoints
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              placeholder="Filter by event name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-surface border border-hairline-subtle text-ink type-micro pl-8 pr-3 py-1.5 focus:border-hairline-strong focus:outline-none w-56 mono-data"
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchEvents(currentCursor)}
            disabled={loading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="type-micro">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-surface border border-hairline-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-hairline-subtle h-9 text-ink-3 type-label bg-surface">
                <th className="font-normal px-4">Event ID</th>
                <th className="font-normal px-4">Event Type</th>
                <th className="font-normal px-4">Status</th>
                <th className="font-normal px-4">Ingest Latency</th>
                <th className="font-normal px-4">Payload Snippet</th>
                <th className="font-normal px-4">Ingested At (UTC)</th>
                <th className="font-normal px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-subtle">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-ink-3 type-micro mono-data">
                    Loading events...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-ink-3 type-micro">
                    No ingested events found.
                  </td>
                </tr>
              ) : (
                events.map((evt) => (
                  <tr
                    key={evt.id}
                    onClick={() => setSelectedEvent(evt)}
                    className="h-11 hover:bg-elevated/40 transition-colors text-ink type-body cursor-pointer"
                  >
                    <td className="px-4 mono-data text-ink-3 type-micro">
                      {evt.id}
                    </td>
                    <td className="px-4 mono-data font-semibold text-ink">
                      {evt.eventName}
                    </td>
                    <td className="px-4">
                      {/* Plain monospace 202 without badge; badge only for 429 */}
                      {evt.statusCode === 202 ? (
                        <span className="mono-data text-ink-2 font-medium">202</span>
                      ) : (
                        <Badge variant="amber">429 LIMIT</Badge>
                      )}
                    </td>
                    <td className="px-4 mono-data text-ink-2">
                      {evt.ingestLatencyMs}ms
                    </td>
                    <td className="px-4 mono-data text-ink-3 type-micro truncate max-w-xs">
                      {JSON.stringify(evt.payload)}
                    </td>
                    <td className="px-4 mono-data text-ink-3 type-micro whitespace-nowrap">
                      {new Date(evt.createdAt).toISOString().substring(0, 19).replace("T", " ")}
                    </td>
                    <td className="px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedEvent(evt)}
                        className="h-7 px-2 text-ink-2 hover:text-ink flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Cursor Pagination Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-hairline-subtle bg-surface">
          <span className="type-micro text-ink-3 mono-data">
            Showing {events.length} events
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={cursorHistory.length === 0}
              onClick={handlePrevious}
              className="flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!nextCursor}
              onClick={handleNext}
              className="flex items-center gap-1"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Event Payload Inspector Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/80">
          <div className="bg-surface border border-hairline max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-hairline-subtle pb-3">
              <div>
                <h3 className="type-section text-ink flex items-center gap-2">
                  <span className="font-semibold text-accent">{selectedEvent.eventName}</span>
                  <span className="text-ink-3">·</span>
                  <span className="mono-data text-ink-3 text-xs">{selectedEvent.id}</span>
                </h3>
                <p className="type-micro text-ink-3 mt-0.5">
                  Ingested at {new Date(selectedEvent.createdAt).toISOString().replace("T", " ").substring(0, 19)} UTC
                  · Latency: {selectedEvent.ingestLatencyMs}ms · Status: {selectedEvent.statusCode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="text-ink-3 hover:text-ink p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Case-preserved JSON Payload Viewer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="type-label text-ink-3">Payload Data</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyPayload(selectedEvent.payload)}
                  className="h-6 px-2 text-ink-3 hover:text-ink flex items-center gap-1"
                >
                  {copiedPayload ? (
                    <>
                      <Check className="w-3 h-3 text-emerald" />
                      <span className="text-emerald text-[11px]">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span className="text-[11px]">Copy JSON</span>
                    </>
                  )}
                </Button>
              </div>

              <div className="bg-inset border border-hairline p-4 max-h-80 overflow-y-auto font-mono text-xs leading-relaxed text-ink select-text">
                <pre>{JSON.stringify(selectedEvent.payload, null, 2)}</pre>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedEvent(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
