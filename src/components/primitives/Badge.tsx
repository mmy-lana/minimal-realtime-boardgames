"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Semantic tone of a {@link Badge}. */
export type BadgeTone = "neutral" | "live" | "pending" | "error" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Defaults to `"neutral"`. */
  tone?: BadgeTone;
  /** Renders a small filled dot before the label. */
  withDot?: boolean;
  /**
   * Dot animation. Only meaningful together with `withDot`. Use `"pulse"` for
   * a live/pending state and `"none"` for everything static.
   */
  dotMotion?: "none" | "pulse";
  children: React.ReactNode;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-board-border text-board-dark bg-board-light",
  live: "border-transparent bg-board-dark text-white",
  pending: "border-status-pending text-status-pending bg-board-light",
  error: "border-status-error text-status-error bg-board-light",
  outline: "border-board-border text-board-muted bg-transparent",
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-board-muted",
  live: "bg-status-live",
  pending: "bg-status-pending",
  error: "bg-status-error",
  outline: "bg-board-border",
};

/**
 * Compact, non-interactive status label. Badges are never buttons: if a badge
 * needs to be actionable, render a {@link Button} or a link instead so it is
 * reachable by keyboard.
 */
export function Badge({
  tone = "neutral",
  withDot = false,
  dotMotion = "none",
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] uppercase leading-none tracking-wider whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {withDot ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            DOT_CLASSES[tone],
            dotMotion === "pulse" && "animate-pulse",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

export default Badge;
