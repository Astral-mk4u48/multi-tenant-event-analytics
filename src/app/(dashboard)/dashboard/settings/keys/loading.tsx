import React from "react";

export default function KeysLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="h-6 w-36 bg-elevated" />
            <div className="h-3 w-64 bg-surface" />
          </div>
          <div className="h-8 w-28 bg-elevated" />
        </div>
        <div className="border border-hairline bg-surface p-4 space-y-2">
          <div className="h-8 w-full bg-elevated" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-full bg-canvas/60" />
          ))}
        </div>
      </div>

      <div className="space-y-4 border-t border-hairline-subtle pt-6">
        <div className="space-y-1">
          <div className="h-5 w-44 bg-elevated" />
          <div className="h-3 w-52 bg-surface" />
        </div>
        <div className="border border-hairline bg-surface p-4 space-y-2">
          <div className="h-8 w-full bg-elevated" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-full bg-canvas/60" />
          ))}
        </div>
      </div>
    </div>
  );
}
