"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Webhook,
  Plus,
  Eye,
  EyeOff,
  Copy,
  Check,
  RotateCw,
  Trash2,
  Filter,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Shield,
  AlertCircle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useDrawer } from "@/components/drawer/DrawerContext";

interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
  health_score: number;
  consecutive_failures: number;
  paused_at: string | null;
  paused_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface DeliveryLogItem {
  id: string;
  event_id: string;
  endpoint_id: string;
  endpoint_url: string;
  event_name: string;
  state: "PENDING" | "DELIVERED" | "FAILED" | "DLQ";
  attempt_count: number;
  max_attempts: number;
  last_status_code: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  created_at: string;
}

export default function WebhooksPage() {
  const { openDrawer } = useDrawer();

  // Endpoints state
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loadingEndpoints, setLoadingEndpoints] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState("*");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);

  // Secret reveal state: map of endpointId -> { secret: string, expiresAt: number }
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, { secret: string; countdown: number }>>({});
  const [copiedSecretId, setCopiedSecretId] = useState<string | null>(null);

  // Delivery Logs state
  const [deliveries, setDeliveries] = useState<DeliveryLogItem[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchFilter, setSearchFilter] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [prevCursor, setPrevCursor] = useState<string | null>(null);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);

  // Fetch Webhook Endpoints
  const fetchEndpoints = useCallback(async () => {
    try {
      setLoadingEndpoints(true);
      const res = await fetch("/api/v1/webhooks");
      if (res.ok) {
        const json = await res.json();
        setEndpoints(json.data || []);
      }
    } catch (e) {
    } finally {
      setLoadingEndpoints(false);
    }
  }, []);

  // Fetch Delivery Logs
  const fetchDeliveries = useCallback(async (cursor?: string | null) => {
    try {
      setLoadingDeliveries(true);
      let url = `/api/v1/deliveries?limit=15`;
      if (statusFilter !== "ALL") {
        url += `&state=${statusFilter}`;
      }
      if (searchFilter) {
        url += `&event=${encodeURIComponent(searchFilter)}`;
      }
      if (cursor) {
        url += `&cursor=${encodeURIComponent(cursor)}`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setDeliveries(json.data || []);
        setNextCursor(json.pagination?.next_cursor || null);
        setPrevCursor(json.pagination?.prev_cursor || null);
      }
    } catch (e) {
    } finally {
      setLoadingDeliveries(false);
    }
  }, [statusFilter, searchFilter]);

  useEffect(() => {
    fetchEndpoints();
  }, [fetchEndpoints]);

  useEffect(() => {
    fetchDeliveries(currentCursor);
  }, [fetchDeliveries, currentCursor]);

  // Secret reveal timer countdown tick
  useEffect(() => {
    const timer = setInterval(() => {
      setRevealedSecrets((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, item] of Object.entries(next)) {
          if (item.countdown <= 1) {
            delete next[id];
            changed = true;
          } else {
            next[id] = { ...item, countdown: item.countdown - 1 };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Toggle Endpoint
  const handleToggle = async (endpoint: WebhookEndpoint) => {
    try {
      const res = await fetch(`/api/v1/webhooks/${endpoint.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !endpoint.enabled }),
      });
      if (res.ok) {
        setEndpoints((prev) =>
          prev.map((e) =>
            e.id === endpoint.id ? { ...e, enabled: !e.enabled } : e
          )
        );
      }
    } catch (err) {
    }
  };

  // Reveal Secret
  const handleRevealSecret = async (endpointId: string) => {
    if (revealedSecrets[endpointId]) {
      // Toggle off
      setRevealedSecrets((prev) => {
        const next = { ...prev };
        delete next[endpointId];
        return next;
      });
      return;
    }

    try {
      const res = await fetch(`/api/v1/webhooks/${endpointId}/secret`, {
        method: "POST",
      });
      if (res.ok) {
        const json = await res.json();
        setRevealedSecrets((prev) => ({
          ...prev,
          [endpointId]: { secret: json.signing_secret, countdown: 10 },
        }));
      }
    } catch (err) {
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSecretId(id);
    setTimeout(() => setCopiedSecretId(null), 2000);
  };

  // Create Endpoint
  const handleCreateEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setIsSubmitting(true);

    try {
      const eventsArray = newEvents
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: newUrl,
          events: eventsArray.length > 0 ? eventsArray : ["*"],
          description: newDescription || undefined,
        }),
      });

      if (!res.ok) {
        const errorJson = await res.json();
        throw new Error(errorJson.error || "Failed to create webhook");
      }

      setIsCreateModalOpen(false);
      setNewUrl("");
      setNewEvents("*");
      setNewDescription("");
      fetchEndpoints();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Endpoint
  const handleDeleteEndpoint = async (endpointId: string) => {
    if (!confirm("Are you sure you want to delete this webhook endpoint? All pending deliveries will be cancelled.")) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/webhooks/${endpointId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setEndpoints((prev) => prev.filter((e) => e.id !== endpointId));
      }
    } catch (err) {
    }
  };

  // Resume Endpoint (Circuit Breaker Reset)
  const handleResumeEndpoint = async (endpointId: string) => {
    try {
      setResumingId(endpointId);
      const res = await fetch(`/api/v1/webhooks/${endpointId}/resume`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchEndpoints();
      }
    } catch (err) {
    } finally {
      setResumingId(null);
    }
  };

  // Replay single delivery
  const handleReplay = async (deliveryId: string) => {
    try {
      setReplayingId(deliveryId);
      const res = await fetch(`/api/v1/deliveries/${deliveryId}/replay`, {
        method: "POST",
      });
      if (res.ok) {
        fetchDeliveries(currentCursor);
      }
    } catch (err) {
    } finally {
      setReplayingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Section 1: Endpoints */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="type-page-title text-ink">Webhook Endpoints</h1>
            <p className="type-body text-ink-3 mt-1">
              Active HTTP destinations signed with HMAC-SHA256
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>New Endpoint</span>
          </Button>
        </div>

        {/* 2-Column Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loadingEndpoints ? (
            <div className="col-span-2 py-12 text-center text-ink-3 type-micro mono-data">
              Loading webhook endpoints...
            </div>
          ) : endpoints.length === 0 ? (
            <div className="col-span-2 py-12 text-center border border-hairline-subtle bg-surface p-8">
              <Webhook className="w-8 h-8 mx-auto mb-3 text-ink-3" />
              <h3 className="type-heading text-ink">No Webhook Endpoints</h3>
              <p className="type-micro text-ink-3 mt-1 max-w-sm mx-auto">
                Register an HTTP endpoint to receive authenticated, retried webhooks on event ingress.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsCreateModalOpen(true)}
                className="mt-4"
              >
                Create First Endpoint
              </Button>
            </div>
          ) : (
            endpoints.map((ep) => {
              const revealInfo = revealedSecrets[ep.id];
              return (
                <div
                  key={ep.id}
                  className="bg-surface border border-hairline-subtle p-5 flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    {/* Header Row: URL, Health Score Badge & Toggle */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="mono-data font-semibold text-ink truncate block">
                            {ep.url}
                          </span>
                          {ep.status === "PAUSED" ? (
                            <Badge variant="crimson">CIRCUIT OPEN</Badge>
                          ) : (ep.health_score ?? 100) >= 95 ? (
                            <Badge variant="emerald">{Number(ep.health_score ?? 100).toFixed(0)}% HEALTH</Badge>
                          ) : (ep.health_score ?? 100) >= 70 ? (
                            <Badge variant="amber">{Number(ep.health_score).toFixed(0)}% HEALTH</Badge>
                          ) : (
                            <Badge variant="crimson">{Number(ep.health_score).toFixed(0)}% DEGRADED</Badge>
                          )}
                        </div>
                        {ep.description && (
                          <p className="type-micro text-ink-3 mt-0.5 truncate">
                            {ep.description}
                          </p>
                        )}
                      </div>

                      {/* 32x16px Toggle Switch */}
                      <button
                        type="button"
                        onClick={() => handleToggle(ep)}
                        className={`w-8 h-4 relative flex items-center transition-colors focus:outline-none flex-shrink-0 ${
                          ep.enabled ? "bg-emerald" : "bg-elevated border border-hairline"
                        }`}
                        title={ep.enabled ? "Disable Endpoint" : "Enable Endpoint"}
                      >
                        <span
                          className={`w-3 h-3 bg-canvas transform transition-transform ${
                            ep.enabled ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>

                    {/* Circuit Breaker Alert Banner */}
                    {ep.status === "PAUSED" && (
                      <div className="p-3 bg-inset border border-crimson/40 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-crimson font-medium type-micro">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>CIRCUIT OPEN (AUTO-PAUSED)</span>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={resumingId === ep.id}
                            onClick={() => handleResumeEndpoint(ep.id)}
                            className="flex items-center gap-1 text-[11px] py-0.5 px-2 h-6"
                          >
                            <RotateCw className={`w-3 h-3 ${resumingId === ep.id ? "animate-spin" : ""}`} />
                            <span>{resumingId === ep.id ? "Resuming..." : "Resume Endpoint"}</span>
                          </Button>
                        </div>
                        <p className="type-micro text-ink-2">
                          {ep.paused_reason || "Triggered due to sustained consecutive delivery failures."}
                        </p>
                        {ep.paused_at && (
                          <div className="type-micro text-ink-3 mono-data text-[10px]">
                            Paused at {new Date(ep.paused_at).toISOString().replace("T", " ").substring(0, 19)} UTC
                          </div>
                        )}
                      </div>
                    )}

                    {/* Subscribed Events Badges */}
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className="type-label text-ink-3 mr-1">EVENTS:</span>
                      {ep.events.map((evt) => (
                        <Badge key={evt} variant="neutral">
                          {evt}
                        </Badge>
                      ))}
                    </div>

                    {/* Signing Secret Box */}
                    <div className="p-2.5 bg-inset border border-hairline-subtle space-y-1.5">
                      <div className="flex items-center justify-between type-micro">
                        <span className="text-ink-3 flex items-center gap-1 font-medium">
                          <Shield className="w-3 h-3 text-crimson" />
                          <span>SIGNING SECRET</span>
                        </span>
                        {revealInfo && (
                          <span className="text-amber mono-data text-[10px]">
                            Auto-hides in {revealInfo.countdown}s
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="mono-data text-ink-2 type-micro truncate select-all">
                          {revealInfo
                            ? revealInfo.secret
                            : "whsec_••••••••••••••••••••••••••••••••"}
                        </span>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRevealSecret(ep.id)}
                            className="p-1 hover:text-ink text-ink-3 transition-colors"
                            title={revealInfo ? "Hide Secret" : "Reveal Secret (10s)"}
                          >
                            {revealInfo ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {revealInfo && (
                            <button
                              type="button"
                              onClick={() => copyToClipboard(revealInfo.secret, ep.id)}
                              className="p-1 hover:text-ink text-ink-3 transition-colors"
                              title="Copy Signing Secret"
                            >
                              {copiedSecretId === ep.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer: Metadata & Delete */}
                  <div className="flex items-center justify-between pt-2 border-t border-hairline-subtle type-micro">
                    <span className="text-ink-3 mono-data">
                      Created {new Date(ep.created_at).toISOString().substring(0, 10)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteEndpoint(ep.id)}
                      className="text-ink-3 hover:text-crimson transition-colors flex items-center gap-1"
                      title="Delete Endpoint"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Section 2: Delivery Logs */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="type-heading text-ink">Delivery Logs</h2>
            <p className="type-body text-ink-3 mt-0.5">
              Audit log of dispatched HTTP attempts, signatures, and retries
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="text"
                placeholder="Filter by event..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="bg-surface border border-hairline-subtle text-ink type-micro pl-8 pr-3 py-1.5 focus:border-hairline-strong focus:outline-none w-44 mono-data"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-surface border border-hairline-subtle text-ink type-micro px-3 py-1.5 focus:border-hairline-strong focus:outline-none mono-data"
            >
              <option value="ALL">Status: All</option>
              <option value="DELIVERED">DELIVERED</option>
              <option value="FAILED">FAILED</option>
              <option value="DLQ">DLQ</option>
              <option value="PENDING">PENDING</option>
            </select>
          </div>
        </div>

        {/* Deliveries Table */}
        <div className="bg-surface border border-hairline-subtle overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-hairline-subtle h-9 text-ink-3 type-label bg-surface">
                  <th className="font-normal px-4">Time (UTC)</th>
                  <th className="font-normal px-4">Event Type</th>
                  <th className="font-normal px-4">Endpoint</th>
                  <th className="font-normal px-4">Status</th>
                  <th className="font-normal px-4">Attempts</th>
                  <th className="font-normal px-4">Latency</th>
                  <th className="font-normal px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-subtle">
                {loadingDeliveries ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-ink-3 type-micro mono-data">
                      Loading delivery logs...
                    </td>
                  </tr>
                ) : deliveries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-ink-3 type-micro">
                      No delivery logs match criteria.
                    </td>
                  </tr>
                ) : (
                  deliveries.map((item) => (
                    <tr
                      key={item.id}
                      className="h-11 hover:bg-elevated/40 transition-colors text-ink type-body"
                    >
                      <td className="px-4 mono-data text-ink-3 type-micro whitespace-nowrap">
                        {new Date(item.created_at).toISOString().substring(11, 19)}
                      </td>
                      <td className="px-4 mono-data font-medium text-ink truncate max-w-[180px]">
                        {item.event_name}
                      </td>
                      <td className="px-4 mono-data text-ink-2 truncate max-w-[220px]">
                        {item.endpoint_url}
                      </td>
                      <td className="px-4 whitespace-nowrap">
                        {item.state === "DELIVERED" ? (
                          <Badge variant="emerald">{item.last_status_code || 200} OK</Badge>
                        ) : item.state === "DLQ" ? (
                          <Badge variant="crimson">DLQ</Badge>
                        ) : item.state === "FAILED" ? (
                          <Badge variant="amber">RETRYING</Badge>
                        ) : (
                          <Badge variant="neutral">PENDING</Badge>
                        )}
                      </td>
                      <td className="px-4 mono-data text-ink-2">
                        {item.attempt_count}/{item.max_attempts}
                      </td>
                      <td className="px-4 mono-data text-ink-3 type-micro">
                        {item.last_latency_ms ? `${item.last_latency_ms}ms` : "—"}
                      </td>
                      <td className="px-4 text-right whitespace-nowrap">
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
                            onClick={() => handleReplay(item.id)}
                            disabled={replayingId === item.id}
                            className="h-7 px-2.5 text-ink"
                          >
                            <RotateCw
                              className={`w-3.5 h-3.5 mr-1 ${
                                replayingId === item.id ? "animate-spin" : ""
                              }`}
                            />
                            <span>Replay</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Toolbar */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-hairline-subtle bg-surface">
            <span className="type-micro text-ink-3 mono-data">
              Showing {deliveries.length} records
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!prevCursor}
                onClick={() => {
                  setCurrentCursor(prevCursor);
                }}
                className="flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!nextCursor}
                onClick={() => {
                  setCurrentCursor(nextCursor);
                }}
                className="flex items-center gap-1"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* New Webhook Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="bg-elevated border border-hairline-strong max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Webhook className="w-4 h-4 text-crimson" />
                <h3 className="type-heading text-ink">New Webhook Endpoint</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-ink-3 hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateEndpoint} className="space-y-4">
              <Input
                label="Endpoint Destination URL"
                placeholder="https://api.yourdomain.com/webhooks"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                required
                className="mono-data"
              />

              <Input
                label="Subscribed Events"
                placeholder="* or user.signup, payment.succeeded"
                value={newEvents}
                onChange={(e) => setNewEvents(e.target.value)}
                required
                className="mono-data"
              />

              <Input
                label="Description (Optional)"
                placeholder="Primary billing webhook handler"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />

              {createError && (
                <div className="p-2.5 bg-crimson-subtle border border-crimson/30 text-crimson type-micro flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting}>
                  {isSubmitting ? "Creating..." : "Create Webhook"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
