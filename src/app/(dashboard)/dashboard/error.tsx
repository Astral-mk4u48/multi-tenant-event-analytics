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
    // Surface uncaught client exceptions to browser console
    console.error("Dashboard Runtime Exception:", error);
  }, [error]);

  return (
    <div className="flex h-[calc(100vh-8rem)] w-full flex-col items-center justify-center bg-[#09090B] p-6 text-center">
      <div className="max-w-md rounded-md border border-[#1E1E24] bg-[#0F0F12] p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[#F1F5F9]">View Error</h2>
        <p className="mt-2 text-xs text-[#94A3B8]">
          An unexpected error occurred while loading this view.
        </p>
        {error.digest && (
          <div className="mt-4 rounded bg-[#18181B] p-2 font-mono text-[11px] text-[#E2E8F0]">
            Digest: {error.digest}
          </div>
        )}
        <button
          onClick={() => reset()}
          className="mt-6 w-full rounded-md bg-[#E11D48] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#F43F5E]"
        >
          Retry View
        </button>
      </div>
    </div>
  );
}
