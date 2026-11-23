"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  Trash2,
  Filter,
  ArrowDown,
  Wifi,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useDrawer } from "@/components/drawer/DrawerContext";

interface LiveEventFrame {
  id: string;
  timestamp: string;
  status: number;
  event: string;
  latency_ms: number;
  payload?: Record<string, unknown>;
  error?: string;
  delivery_id?: string;
}

const MAX_BUFFER_SIZE = 5000;

export default function LiveTailPage() {
  const { openDrawer } = useDrawer();
  const [events, setEvents] = useState<LiveEventFrame[]>([]);
  const [isStreaming, setIsStreaming] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [eventFilter, setEventFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "200" | "429">("ALL");
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const terminalRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  const isScrolledUpRef = useRef(isScrolledUp);
  isScrolledUpRef.current = isScrolledUp;

  // Setup EventSource connection
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/v1/events/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const frame: LiveEventFrame = JSON.parse(event.data);

        // If paused, drop or ignore frame
        if (!isStreamingRef.current) return;

        setEvents((prev) => {
          const next = [frame, ...prev];
          if (next.length > MAX_BUFFER_SIZE) {
            return next.slice(0, MAX_BUFFER_SIZE);
          }
          return next;
        });

        if (isScrolledUpRef.current) {
          setUnreadCount((c) => c + 1);
        }
      } catch (e) {
        console.error("Failed to parse SSE frame", e);
      }
    };

    es.onerror = () => {
      setIsConnected(false);
    };
  }, []);

  useEffect(() => {
    connectSSE();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connectSSE]);

  // Handle scroll detection
  const handleScroll = () => {
    if (!terminalRef.current) return;
    const { scrollTop } = terminalRef.current;
    if (scrollTop > 60) {
      setIsScrolledUp(true);
    } else {
      setIsScrolledUp(false);
      setUnreadCount(0);
    }
  };

  const jumpToTop = () => {
    if (terminalRef.current) {
      terminalRef.current.scrollTo({ top: 0, behavior: "smooth" });
      setIsScrolledUp(false);
      setUnreadCount(0);
    }
  };

  const clearBuffer = () => {
    setEvents([]);
    setUnreadCount(0);
  };

  // Filter events
  const filteredEvents = events.filter((e) => {
    if (eventFilter && !e.event.toLowerCase().includes(eventFilter.toLowerCase())) {
      return false;
    }
    if (statusFilter === "200" && (e.status < 200 || e.status >= 300)) {
      return false;
    }
    if (statusFilter === "429" && e.status !== 429) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.topbar)-theme(spacing.12))] space-y-4">
      {/* Top Header & Live Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="type-page-title text-ink">Live Tail</h1>
          <div className="flex items-center gap-2 px-2.5 py-1 bg-surface border border-hairline-subtle">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected
                  ? isStreaming
                    ? "status-dot-emerald pulse-soft"
                    : "bg-amber"
                  : "bg-crimson"
              }`}
            />
            <span className="type-micro mono-data text-ink-2">
              {isConnected
                ? isStreaming
                  ? "STREAMING"
                  : "PAUSED"
                : "DISCONNECTED"}
            </span>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Pause / Resume Button */}
          <Button
            variant={isStreaming ? "secondary" : "primary"}
            size="sm"
            onClick={() => setIsStreaming(!isStreaming)}
            className="flex items-center gap-1.5"
          >
            {isStreaming ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Resume</span>
              </>
            )}
          </Button>

          {/* Event Filter */}
          <div className="relative">
            <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              placeholder="Filter by event... (/)"
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="bg-surface border border-hairline-subtle text-ink type-micro pl-8 pr-3 py-1.5 focus:border-hairline-strong focus:outline-none w-48 mono-data"
            />
          </div>

          {/* Status Dropdown */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "ALL" | "200" | "429")}
            className="bg-surface border border-hairline-subtle text-ink type-micro px-3 py-1.5 focus:border-hairline-strong focus:outline-none mono-data"
          >
            <option value="ALL">Status: All</option>
            <option value="200">200 OK</option>
            <option value="429">429 Rate Limited</option>
          </select>

          {/* Clear Buffer */}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearBuffer}
            className="text-ink-3 hover:text-ink flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </Button>

          {/* Buffer Capacity Badge */}
          <span className="type-micro mono-data text-ink-3 px-2 py-1 bg-surface border border-hairline-subtle">
            {filteredEvents.length.toLocaleString()} / {MAX_BUFFER_SIZE.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Disconnect Warning Banner */}
      {!isConnected && (
        <div className="flex items-center justify-between px-4 py-2 bg-crimson-subtle border border-crimson/30 text-crimson type-micro">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4" />
            <span>Live Tail stream disconnected. Re-establishing connection...</span>
          </div>
          <button
            onClick={connectSSE}
            className="underline font-semibold hover:text-ink mono-data flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Reconnect
          </button>
        </div>
      )}

      {/* Full-Height Streaming Terminal Container */}
      <div className="relative flex-1 bg-inset border border-hairline-subtle flex flex-col min-h-0 overflow-hidden">
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-surface/70 border-b border-hairline-subtle type-label text-ink-3">
          <div className="flex items-center gap-6">
            <span className="w-24">TIME (UTC)</span>
            <span className="w-20">STATUS</span>
            <span className="w-20">LATENCY</span>
            <span className="w-48">EVENT TYPE</span>
            <span>PAYLOAD PREVIEW</span>
          </div>
          <span>AUTOSCROLL: {isScrolledUp ? "PAUSED" : "ACTIVE"}</span>
        </div>

        {/* Scrollable Event Stream */}
        <div
          ref={terminalRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto divide-y divide-hairline-subtle font-mono type-micro select-text"
        >
          {filteredEvents.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-ink-3">
              <Wifi className="w-8 h-8 mb-3 opacity-30 text-ink" />
              <p className="font-medium text-ink-2">Waiting for events...</p>
              <p className="mt-1 max-w-sm">
                Stream connected. Post payloads to <code className="text-ink">/api/v1/events</code> to view live ingress stream.
              </p>
            </div>
          ) : (
            filteredEvents.map((evt) => (
              <div
                key={evt.id + evt.timestamp}
                onClick={() => {
                  if (evt.delivery_id) {
                    openDrawer(evt.delivery_id);
                  }
                }}
                className={`flex items-center px-4 py-2 gap-6 hover:bg-surface/60 transition-colors cursor-pointer group ${
                  evt.status === 429
                    ? "bg-amber-subtle/30"
                    : evt.status >= 500
                    ? "bg-crimson-subtle/30"
                    : ""
                }`}
              >
                {/* Timestamp */}
                <span className="w-24 text-ink-3 mono-data flex-shrink-0">
                  {new Date(evt.timestamp).toISOString().substring(11, 23)}
                </span>

                {/* Status Badge */}
                <span className="w-20 flex-shrink-0">
                  {evt.status === 200 || evt.status === 202 ? (
                    <Badge variant="emerald">{evt.status} OK</Badge>
                  ) : evt.status === 429 ? (
                    <Badge variant="amber">429 LIMIT</Badge>
                  ) : (
                    <Badge variant="crimson">{evt.status} ERR</Badge>
                  )}
                </span>

                {/* Latency */}
                <span className="w-20 text-ink-3 mono-data flex-shrink-0">
                  {evt.latency_ms}ms
                </span>

                {/* Event Name */}
                <span className="w-48 font-semibold text-ink mono-data truncate flex-shrink-0">
                  {evt.event}
                </span>

                {/* Payload JSON snippet */}
                <span className="text-ink-2 mono-data truncate flex-1">
                  {evt.payload
                    ? JSON.stringify(evt.payload)
                    : evt.error || "—"}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Floating "Jump to bottom (+N new)" banner when scrolled up */}
        {isScrolledUp && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
            <button
              onClick={jumpToTop}
              className="flex items-center gap-2 px-3 py-1.5 bg-elevated border border-hairline-strong text-ink type-micro mono-data shadow-none hover:bg-surface transition-colors"
            >
              <ArrowDown className="w-3.5 h-3.5 text-crimson animate-bounce" />
              <span>
                Paused (scrolled) &bull; Jump to latest {unreadCount > 0 ? `(+${unreadCount} new)` : ""}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
