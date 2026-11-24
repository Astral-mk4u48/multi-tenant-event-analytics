"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Key,
  Plus,
  Trash2,
  Users,
  Copy,
  Check,
  Shield,
  AlertTriangle,
  X,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { KeyRevealModal } from "@/components/modals/KeyRevealModal";

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  scope: "INGEST" | "ADMIN";
  env: "live" | "test";
  created_at: string;
  last_used_at: string | null;
}

interface TeamMemberItem {
  id: string;
  user_id: string;
  email: string;
  role: "OWNER" | "ADMIN" | "VIEWER";
  created_at: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // Key creation state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyEnv, setKeyEnv] = useState<"live" | "test">("live");
  const [keyScope, setKeyScope] = useState<"INGEST" | "ADMIN">("INGEST");
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [createError, setCreateError] = useState("");

  // Key reveal state
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{
    key: string;
    name: string;
    prefix: string;
  } | null>(null);

  // Revoke state
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      setLoadingKeys(true);
      const res = await fetch("/api/v1/keys");
      if (res.ok) {
        const json = await res.json();
        setKeys(json.data || json.keys || json.items || []);
      }
    } catch (err) {
      console.error("Failed to load keys", err);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  const fetchTeam = useCallback(async () => {
    try {
      setLoadingMembers(true);
      const res = await fetch("/api/v1/team");
      if (res.ok) {
        const json = await res.json();
        setMembers(json.data || json.members || json.items || []);
      }
    } catch (err) {
      console.error("Failed to load team", err);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
    fetchTeam();
  }, [fetchKeys, fetchTeam]);

  // Create Key
  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setIsCreatingKey(true);

    try {
      const res = await fetch("/api/v1/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: keyName,
          scope: keyScope,
          env: keyEnv,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to create API key");
      }

      const json = await res.json();
      setIsCreateModalOpen(false);
      setKeyName("");

      // Trigger Key Reveal Modal
      setNewlyCreatedKey({
        key: json.rawKey || json.plaintext_key || "",
        name: json.name,
        prefix: json.prefix,
      });

      fetchKeys();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setIsCreatingKey(false);
    }
  };

  // Revoke Key
  const handleRevokeKey = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to permanently revoke "${name}"? Immediate rejection will occur on subsequent requests.`)) {
      return;
    }

    try {
      setRevokingId(id);
      const res = await fetch(`/api/v1/keys/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== id));
      }
    } catch (err) {
      console.error("Revoke failed", err);
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-10">
      {/* Section 1: API Keys */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="type-page-title text-ink">API Keys &amp; Access</h1>
            <p className="type-body text-ink-3 mt-1">
              Authentication credentials for ingesting events and querying pipeline telemetry
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Create Key</span>
          </Button>
        </div>

        {/* Keys Table */}
        <div className="bg-surface border border-hairline-subtle overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-hairline-subtle h-9 text-ink-3 type-label bg-surface">
                  <th className="font-normal px-4">Name &amp; Prefix</th>
                  <th className="font-normal px-4">Environment</th>
                  <th className="font-normal px-4">Scope</th>
                  <th className="font-normal px-4">Created (UTC)</th>
                  <th className="font-normal px-4">Last Used</th>
                  <th className="font-normal px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-subtle">
                {loadingKeys ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-ink-3 type-micro mono-data">
                      Loading API keys...
                    </td>
                  </tr>
                ) : keys.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-ink-3 type-micro">
                      No active API keys found.
                    </td>
                  </tr>
                ) : (
                  keys.map((k) => (
                    <tr
                      key={k.id}
                      className="h-11 hover:bg-elevated/40 transition-colors text-ink type-body"
                    >
                      <td className="px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">{k.name}</span>
                          <span className="mono-data text-ink-3 type-micro px-1.5 py-0.5 bg-inset border border-hairline-subtle">
                            {k.prefix}...
                          </span>
                        </div>
                      </td>
                      <td className="px-4">
                        <Badge variant={k.env === "live" ? "emerald" : "neutral"}>
                          {k.env.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-4">
                        <Badge variant={k.scope === "ADMIN" ? "crimson" : "neutral"}>
                          {k.scope}
                        </Badge>
                      </td>
                      <td className="px-4 mono-data text-ink-3 type-micro whitespace-nowrap">
                        {new Date(k.created_at).toISOString().substring(0, 10)}
                      </td>
                      <td className="px-4 mono-data text-ink-3 type-micro whitespace-nowrap">
                        {k.last_used_at
                          ? new Date(k.last_used_at).toISOString().substring(0, 19).replace("T", " ")
                          : "Never"}
                      </td>
                      <td className="px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeKey(k.id, k.name)}
                          disabled={revokingId === k.id}
                          className="h-7 px-2 text-ink-3 hover:text-crimson"
                          title="Revoke Key"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          <span>Revoke</span>
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Section 2: Team Members RBAC */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="type-heading text-ink">Team Members &amp; RBAC</h2>
            <p className="type-body text-ink-3 mt-1">
              Role-based access permissions enforcing tenant data isolation
            </p>
          </div>
        </div>

        {/* Members Table */}
        <div className="bg-surface border border-hairline-subtle overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-hairline-subtle h-9 text-ink-3 type-label bg-surface">
                  <th className="font-normal px-4">Member Email</th>
                  <th className="font-normal px-4">Assigned Role</th>
                  <th className="font-normal px-4">Access Level</th>
                  <th className="font-normal px-4">Joined (UTC)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-subtle">
                {loadingMembers ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-ink-3 type-micro mono-data">
                      Loading team roster...
                    </td>
                  </tr>
                ) : (
                  members.map((m) => (
                    <tr
                      key={m.id}
                      className="h-11 hover:bg-elevated/40 transition-colors text-ink type-body"
                    >
                      <td className="px-4 font-medium text-ink mono-data">
                        {m.email}
                      </td>
                      <td className="px-4">
                        <Badge
                          variant={
                            m.role === "OWNER"
                              ? "crimson"
                              : m.role === "ADMIN"
                              ? "amber"
                              : "neutral"
                          }
                        >
                          {m.role}
                        </Badge>
                      </td>
                      <td className="px-4 type-micro text-ink-3">
                        {m.role === "OWNER"
                          ? "Full administrative control, billing & member management"
                          : m.role === "ADMIN"
                          ? "Key generation, endpoint management & event replay"
                          : "Read-only access to metrics, logs & inspector"}
                      </td>
                      <td className="px-4 mono-data text-ink-3 type-micro whitespace-nowrap">
                        {new Date(m.created_at).toISOString().substring(0, 10)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Key Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="bg-elevated border border-hairline-strong max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-crimson" />
                <h3 className="type-heading text-ink">Generate New API Key</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-ink-3 hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateKey} className="space-y-4">
              <Input
                label="Key Name"
                placeholder="e.g. Ingestion Pipeline Worker"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                required
              />

              <div className="space-y-1.5">
                <label className="type-label text-ink-3 block">Environment</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKeyEnv("live")}
                    className={`py-2 px-3 border type-micro mono-data text-center transition-colors ${
                      keyEnv === "live"
                        ? "bg-surface border-crimson text-ink font-semibold"
                        : "bg-surface/50 border-hairline-subtle text-ink-3 hover:text-ink"
                    }`}
                  >
                    LIVE (Production)
                  </button>
                  <button
                    type="button"
                    onClick={() => setKeyEnv("test")}
                    className={`py-2 px-3 border type-micro mono-data text-center transition-colors ${
                      keyEnv === "test"
                        ? "bg-surface border-crimson text-ink font-semibold"
                        : "bg-surface/50 border-hairline-subtle text-ink-3 hover:text-ink"
                    }`}
                  >
                    TEST (Sandbox)
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="type-label text-ink-3 block">Permission Scope</label>
                <select
                  value={keyScope}
                  onChange={(e) => setKeyScope(e.target.value as "INGEST" | "ADMIN")}
                  className="w-full bg-surface border border-hairline-subtle text-ink type-body px-3 py-2 focus:border-hairline-strong focus:outline-none mono-data"
                >
                  <option value="INGEST">INGEST (Ingest events only)</option>
                  <option value="ADMIN">ADMIN (Full API read &amp; write)</option>
                </select>
              </div>

              {createError && (
                <div className="p-2.5 bg-crimson-subtle border border-crimson/30 text-crimson type-micro">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={isCreatingKey}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isCreatingKey}>
                  {isCreatingKey ? "Generating..." : "Generate Key"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 480px One-Time Key Reveal Modal */}
      {newlyCreatedKey && (
        <KeyRevealModal
          isOpen={true}
          apiKey={newlyCreatedKey.key}
          keyName={newlyCreatedKey.name}
          onClose={() => setNewlyCreatedKey(null)}
        />
      )}
    </div>
  );
}
