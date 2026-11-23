import React from "react";

export type BadgeVariant =
  | "success"
  | "warning"
  | "error"
  | "neutral"
  | "accent"
  | "emerald"
  | "amber"
  | "crimson"
  | "ghost";

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "neutral", children, className = "" }: BadgeProps) {
  const variantClasses: Record<BadgeVariant, string> = {
    success: "badge-success",
    emerald: "badge-success",
    warning: "badge-warning",
    amber: "badge-warning",
    error: "badge-error",
    crimson: "badge-error",
    neutral: "badge-neutral",
    ghost: "badge-neutral",
    accent: "badge-accent",
  };

  return (
    <span className={`badge ${variantClasses[variant] || "badge-neutral"} ${className}`}>
      {children}
    </span>
  );
}

export function HttpStatusBadge({ status, isTimeout = false }: { status?: number | null; isTimeout?: boolean }) {
  if (isTimeout || status === null || status === undefined) {
    return <Badge variant="error">TIMEOUT</Badge>;
  }

  if (status >= 200 && status < 300) {
    return <Badge variant="success">{status}</Badge>;
  }
  if (status >= 300 && status < 400) {
    return <Badge variant="warning">{status}</Badge>;
  }
  if (status === 429) {
    return <Badge variant="warning">429</Badge>;
  }
  if (status >= 400) {
    return <Badge variant="error">{status}</Badge>;
  }
  return <Badge variant="neutral">{status}</Badge>;
}
