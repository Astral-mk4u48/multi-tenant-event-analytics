import React from "react";

export default function WebhooksLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-6 w-44 bg-elevated" />
          <div className="h-3 w-64 bg-surface" />
        </div>
        <div className="h-8 w-32 bg-elevated" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-36 border border-hairline bg-surface p-5 space-y-3">
            <div className="h-5 w-72 bg-elevated" />
            <div className="h-4 w-40 bg-elevated/70" />
            <div className="h-8 w-full bg-canvas/40" />
          </div>
        ))}
      </div>
    </div>
  );
}
