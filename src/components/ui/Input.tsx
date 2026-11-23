import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  kbdHint?: string;
  leftIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, kbdHint, leftIcon, className = "", ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block type-label text-ink-3 mb-1.5">
            {label}
          </label>
        )}
        <div className="relative inline-flex items-center w-full">
          {leftIcon && (
            <span className="absolute left-2.5 text-ink-3 pointer-events-none flex items-center">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            className={`h-[32px] w-full bg-surface border border-hairline hover:border-hairline-strong focus:border-accent text-ink placeholder:text-ink-3 text-[13px] px-3 transition-colors duration-150 ease-out focus:outline-none ${
              leftIcon ? "pl-8" : ""
            } ${kbdHint ? "pr-8" : ""} ${className}`}
            {...props}
          />
          {kbdHint && (
            <span className="absolute right-2 kbd pointer-events-none select-none">
              {kbdHint}
            </span>
          )}
        </div>
      </div>
    );
  }
);

Input.displayName = "Input";
