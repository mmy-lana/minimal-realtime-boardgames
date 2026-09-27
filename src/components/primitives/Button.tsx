"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Visual weight of a {@link Button}. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/** Height + horizontal padding preset. `md` is the default control height. */
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Defaults to `"primary"`. */
  variant?: ButtonVariant;
  /** Defaults to `"md"`. */
  size?: ButtonSize;
  /** Stretch to the width of the containing block. */
  fullWidth?: boolean;
  /**
   * Puts the control into a busy state: the button is disabled, an inline
   * progress dot is rendered, and `aria-busy` is set. A loading button never
   * fires `onClick`.
   */
  loading?: boolean;
  /**
   * Accessible text announced while `loading` is true. Falls back to the
   * button's own accessible name when omitted.
   */
  loadingLabel?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-board-dark text-white border border-board-dark hover:bg-board-muted active:bg-board-dark disabled:bg-board-muted",
  secondary:
    "bg-board-light text-board-dark border border-board-border hover:bg-board-subtle active:bg-board-light disabled:text-board-muted",
  ghost:
    "bg-transparent text-board-dark border border-transparent hover:bg-board-subtle active:bg-transparent disabled:text-board-muted",
  danger:
    "bg-board-light text-status-error border border-status-error hover:bg-status-error hover:text-white active:bg-board-light disabled:border-board-border disabled:text-board-muted",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

const SPINNER_CLASS =
  "inline-block size-3 shrink-0 animate-spin rounded-full border border-current border-t-transparent";

/**
 * The single button primitive for the whole application.
 *
 * Rendering rules every call site relies on:
 * - `type` defaults to `"button"`, so a button inside the home page's room
 *   creation form never submits by accident.
 * - `loading` implies `disabled` and is announced through `aria-busy`.
 * - Disabled buttons keep a hairline so surrounding layout never shifts.
 */
export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  loadingLabel,
  className,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps) {
  const isInert = Boolean(disabled) || loading;

  return (
    <button
      {...rest}
      type={type ?? "button"}
      disabled={isInert}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-none font-medium uppercase tracking-wide",
        "transition-colors duration-100 select-none",
        "disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {loading ? <span className={SPINNER_CLASS} aria-hidden="true" /> : null}
      {loading && loadingLabel ? <span>{loadingLabel}</span> : children}
    </button>
  );
}

export default Button;
