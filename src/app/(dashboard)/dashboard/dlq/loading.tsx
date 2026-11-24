import React from "react";

export default function DlqLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-6 w-40 bg-elevated" />
          <div className="h-3 w-56 bg-surface" />
        </div>
        <div className="h-8 w-44 bg-elevated" />
      </div>
      <div className="border border-hairline bg-surface p-4 space-y-2">
        <div className="h-8 w-full bg-elevated" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 w-full bg-canvas/60" />
        ))}
      </div>
    </div>
  );
}
