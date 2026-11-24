import React from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive-outline"
  | "danger";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "default" | "sm";
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "default",
      isLoading = false,
      icon,
      children,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const base =
      "inline-flex items-center justify-center font-sans font-medium transition-colors duration-150 ease-out select-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap";

    const sizes = {
      default: "h-[32px] px-3 text-[13px] gap-1.5",
      sm: "h-[28px] px-2 text-[12px] gap-1.5",
    };

    const destructiveStyle =
      "bg-transparent hover:bg-crimson-subtle hover:border-crimson active:bg-crimson/20 text-crimson border border-crimson/40";

    const variants: Record<ButtonVariant, string> = {
      primary:
        "bg-crimson hover:bg-crimson-hover active:bg-crimson-hover text-white border border-transparent",
      secondary:
        "bg-elevated hover:border-hairline-strong active:bg-surface text-ink border border-hairline",
      ghost:
        "bg-transparent hover:bg-elevated hover:text-ink active:bg-surface text-ink-2 border border-transparent",
      "destructive-outline": destructiveStyle,
      danger: destructiveStyle,
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${base} ${sizes[size]} ${variants[variant] || variants.secondary} ${className}`}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 size={14} className="animate-spin text-current" strokeWidth={1.75} />
            <span>{children}</span>
          </>
        ) : (
          <>
            {icon && <span className="shrink-0">{icon}</span>}
            {children}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
