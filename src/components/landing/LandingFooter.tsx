"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy" | "checking";
  latencyMs?: number;
}

export function LandingFooter() {
  const [health, setHealth] = useState<HealthStatus>({ status: "checking" });

  useEffect(() => {
    let mounted = true;

    async function checkHealth() {
      try {
        const start = performance.now();
        const res = await fetch("/api/healthz", { cache: "no-store" });
        const latency = Math.round(performance.now() - start);

        if (res.ok) {
          const json = await res.json();
          if (mounted) {
            setHealth({
              status: json.status === "healthy" ? "healthy" : "degraded",
              latencyMs: latency,
            });
          }
        } else {
          if (mounted) setHealth({ status: "degraded", latencyMs: latency });
        }
      } catch {
        if (mounted) setHealth({ status: "unhealthy" });
      }
    }

    checkHealth();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <footer className="border-t border-hairline-subtle px-6 py-6 max-w-7xl mx-auto w-full text-xs font-mono text-ink-3">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                health.status === "healthy"
                  ? "bg-status-success"
                  : health.status === "degraded"
                  ? "bg-amber"
                  : health.status === "checking"
                  ? "bg-ink-3 animate-pulse"
                  : "bg-crimson"
              }`}
            />
            <span className="text-ink-2">
              {health.status === "healthy"
                ? "All Systems Operational"
                : health.status === "degraded"
                ? "Degraded Performance"
                : health.status === "checking"
                ? "Verifying Status..."
                : "System Disrupted"}
            </span>
            {health.latencyMs !== undefined && (
              <span className="text-[10px] text-ink-3 tabular-nums">({health.latencyMs}ms)</span>
            )}
          </div>
          <span className="text-hairline-strong">•</span>
          <Link
            href="/docs"
            className="hover:text-ink text-ink-2 transition-colors duration-150"
          >
            Docs
          </Link>
          <Link
            href="/privacy"
            className="hover:text-ink text-ink-2 transition-colors duration-150"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="hover:text-ink text-ink-2 transition-colors duration-150"
          >
            Terms
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://github.com/Astral-mk4u48/multi-tenant-event-analytics"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink text-ink-2 transition-colors duration-150 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
            GitHub
          </a>
          <span className="text-hairline-strong">•</span>
          <span className="text-ink-3">MIT License</span>
        </div>
      </div>
    </footer>
  );
}
