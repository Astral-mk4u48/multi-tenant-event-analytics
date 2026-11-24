import React from "react";

export default function LiveTailLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-6 w-28 bg-elevated" />
          <div className="h-3 w-48 bg-surface" />
        </div>
        <div className="h-8 w-36 bg-elevated" />
      </div>
      <div className="h-[520px] border border-hairline bg-surface p-4 space-y-2">
        <div className="h-8 w-full bg-elevated" />
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-10 w-full bg-canvas/60" />
        ))}
      </div>
    </div>
  );
}
