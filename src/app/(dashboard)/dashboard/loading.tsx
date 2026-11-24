import React from "react";

export default function OverviewLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Title Skeleton */}
      <div className="space-y-2">
        <div className="h-6 w-32 bg-elevated rounded-none" />
        <div className="h-3 w-64 bg-surface rounded-none" />
      </div>

      {/* KPI Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 border border-hairline bg-surface p-4 space-y-3">
            <div className="h-3 w-24 bg-elevated" />
            <div className="h-8 w-20 bg-elevated" />
            <div className="h-3 w-16 bg-elevated" />
          </div>
        ))}
      </div>

      {/* Chart Skeleton */}
      <div className="h-72 border border-hairline bg-surface p-4 flex flex-col justify-between">
        <div className="h-4 w-48 bg-elevated" />
        <div className="h-44 w-full bg-canvas/40" />
      </div>

      {/* Tables Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-64 border border-hairline bg-surface p-4 space-y-3">
          <div className="h-4 w-36 bg-elevated" />
          <div className="space-y-2 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-8 w-full bg-canvas/60" />
            ))}
          </div>
        </div>
        <div className="h-64 border border-hairline bg-surface p-4 space-y-3">
          <div className="h-4 w-44 bg-elevated" />
          <div className="space-y-2 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-8 w-full bg-canvas/60" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
