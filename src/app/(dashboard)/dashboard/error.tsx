"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Deliver client runtime failure with digest to backend pino logger
    try {
      fetch("/api/v1/telemetry/error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          digest: error.digest,
        }),
      }).catch(() => {});
    } catch {
      // Ignore boundary transport errors
    }
  }, [error]);

  return (
    <div className="flex h-[calc(100vh-8rem)] w-full flex-col items-center justify-center bg-canvas p-6 text-center">
      <div className="max-w-md border border-hairline bg-surface p-6">
        <h2 className="text-lg font-semibold text-ink">View failed to load</h2>
        <p className="mt-2 text-xs text-ink-2">
          An unexpected error occurred while rendering this view.
        </p>
        {error.digest && (
          <div className="mt-4 bg-inset p-2 font-mono text-[11px] text-ink-2">
            Digest ID: {error.digest}
          </div>
        )}
        <button
          onClick={() => reset()}
          className="mt-6 w-full bg-accent px-4 py-2 text-xs font-medium text-white transition-colors duration-150 hover:bg-accent-hover"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
