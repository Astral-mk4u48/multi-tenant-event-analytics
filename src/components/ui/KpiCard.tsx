import React from "react";
import Link from "next/link";
import { Badge, BadgeVariant } from "./Badge";

export interface KpiCardProps {
  label?: string;
  title?: string;
  value: string | number;
  delta?: number | string;
  deltaType?: "positive" | "negative" | "neutral";
  subtitle?: string;
  icon?: React.ReactNode | React.ElementType;
  href?: string;
  isLoading?: boolean;
  loading?: boolean;
  isError?: boolean;
  badgeText?: string;
  badgeVariant?: BadgeVariant;
}

export function KpiCard({
  label,
  title,
  value,
  delta,
  deltaType = "neutral",
  subtitle,
  icon: Icon,
  href,
  isLoading = false,
  loading = false,
  isError = false,
  badgeText,
  badgeVariant = "crimson",
}: KpiCardProps) {
  const isCardLoading = isLoading || loading;
  const displayTitle = title || label || "";

  const deltaFormatted =
    typeof delta === "number"
      ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`
      : delta;

  const deltaColor =
    deltaType === "positive"
      ? "text-emerald"
      : deltaType === "negative"
      ? "text-crimson"
      : "text-ink-3";

  const renderIcon = () => {
    if (!Icon) return null;
    if (React.isValidElement(Icon)) return Icon;
    if (typeof Icon === "function" || typeof Icon === "object") {
      const IconComponent = Icon as React.ElementType;
      return <IconComponent className="w-4 h-4 text-ink-3" />;
    }
    return null;
  };

  const content = (
    <div
      className={`bg-surface border border-hairline-subtle p-4 min-h-[110px] flex flex-col justify-between transition-colors duration-150 ${
        href ? "hover:border-hairline cursor-pointer" : ""
      } ${isError ? "border-crimson/30" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="type-micro uppercase text-ink-3 font-medium">{displayTitle}</span>
        <div className="flex items-center gap-2">
          {badgeText && (
            <Badge variant={badgeVariant} className="text-[10px]">
              {badgeText}
            </Badge>
          )}
          {renderIcon()}
        </div>
      </div>

      <div className="mt-3">
        {isCardLoading ? (
          <div className="w-24 h-7 skeleton mb-1" />
        ) : isError ? (
          <div className="type-kpi text-crimson">ERR</div>
        ) : (
          <div className="type-kpi text-ink mono-data">{value}</div>
        )}

        {isCardLoading ? (
          <div className="w-32 h-3 skeleton mt-1" />
        ) : isError ? (
          <div className="type-micro mono-data text-crimson mt-0.5">metrics unavailable</div>
        ) : (
          <div className="flex items-center gap-1.5 mt-0.5 type-micro mono-data">
            {deltaFormatted && (
              <span className={`font-medium ${deltaColor}`}>{deltaFormatted}</span>
            )}
            {subtitle && (
              <span className="text-ink-3">
                {deltaFormatted ? `• ${subtitle}` : subtitle}
              </span>
            )}
            {!deltaFormatted && !subtitle && (
              <span className="text-ink-3">no prior data</span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}
