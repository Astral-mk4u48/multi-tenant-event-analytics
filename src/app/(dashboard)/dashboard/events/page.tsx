"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Activity, Filter, RefreshCw, Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useDrawer } from "@/components/drawer/DrawerContext";

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
  const { openDrawer } = useDrawer();
  const [events, setEvents] = useState<IngestedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      let url = "/api/v1/events?limit=50";
      if (search) {
        url += `&search=${encodeURIComponent(search)}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setEvents(json.data || []);
      }
    } catch (err) {
      console.error("Failed to load events", err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

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
              placeholder="Filter by event name... (/)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-surface border border-hairline-subtle text-ink type-micro pl-8 pr-3 py-1.5 focus:border-hairline-strong focus:outline-none w-48 mono-data"
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={fetchEvents}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline-subtle">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-ink-3 type-micro mono-data">
                    Loading events...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-ink-3 type-micro">
                    No ingested events found.
                  </td>
                </tr>
              ) : (
                events.map((evt) => (
                  <tr
                    key={evt.id}
                    className="h-11 hover:bg-elevated/40 transition-colors text-ink type-body"
                  >
                    <td className="px-4 mono-data text-ink-3 type-micro">
                      {evt.id}
                    </td>
                    <td className="px-4 mono-data font-semibold text-ink">
                      {evt.eventName}
                    </td>
                    <td className="px-4">
                      {evt.statusCode === 202 ? (
                        <Badge variant="emerald">202 ACCEPTED</Badge>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
