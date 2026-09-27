"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Edge length preset. `md` is the 32px control default from Section 2.3. */
export type BoardTileSize = "sm" | "md" | "lg";

/**
 * Border treatment of a tile. Grid lines are supplied by the parent board
 * container, so tiles themselves only carry a hairline ring.
 */
export type BoardTileEmphasis = "none" | "subtle" | "strong";

export interface BoardTileProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /**
   * Screen-reader description of what tapping this square does, e.g.
   * `"Row 2 column 3, empty, place black"`. Required — a board square that
   * renders only a visual marker is unusable without it.
   */
  label: string;
  /** Edge length preset. Defaults to `"md"`. */
  size?: BoardTileSize;
  /** Square (default) or circular hit area. Circular matches disc games. */
  shape?: "square" | "circle";
  /** Renders the selection ring used for movement-game piece selection. */
  selected?: boolean;
  /** Renders the legal-move indicator. */
  isLegalTarget?: boolean;
  /** Highlights the square touched by the most recent ply. */
  isLastMove?: boolean;
  /** Hairline ring weight. Defaults to `"none"`. */
  emphasis?: BoardTileEmphasis;
  children?: React.ReactNode;
}

const SIZE_CLASSES: Record<BoardTileSize, string> = {
  sm: "size-[22px]",
  md: "size-8",
  lg: "size-11",
};

const EMPHASIS_CLASSES: Record<BoardTileEmphasis, string> = {
  none: "border-transparent",
  subtle: "border-board-border",
  strong: "border-board-dark",
};

/**
 * A single interactive square on a game board.
 *
 * Touch behaviour (Section 2.2) is implemented here once, for every board:
 * long-press never raises the iOS callout, double-tap never selects text, the
 * magnifier never appears, and a held finger never fires a native context menu.
 * The `data-board-surface` attribute opts the element into the matching base
 * rules in `globals.css`; the inline `WebkitTouchCallout`/`touchAction`
 * declarations cover WebKit builds where the attribute alone is ignored.
 */
export function BoardTile({
  label,
  size = "md",
  shape = "square",
  selected = false,
  isLegalTarget = false,
  isLastMove = false,
  emphasis = "none",
  className,
  children,
  onContextMenu,
  onDragStart,
  type,
  ...rest
}: BoardTileProps) {
  return (
    <button
      {...rest}
      type={type ?? "button"}
      aria-label={label}
      aria-pressed={selected || undefined}
      data-board-surface=""
      data-square={isLegalTarget ? "legal" : undefined}
      data-selected={selected ? "true" : undefined}
      data-last-move={isLastMove ? "true" : undefined}
      onContextMenu={(event) => {
        // Suppress the native long-press menu on desktop and iOS Safari.
        event.preventDefault();
        onContextMenu?.(event);
      }}
      onDragStart={(event) => {
        // Board squares are not draggable; a stray drag would start a text
        // selection or native image drag.
        event.preventDefault();
        onDragStart?.(event);
      }}
      style={{
        touchAction: "manipulation",
        WebkitTouchCallout: "none",
        ...rest.style,
      }}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        "select-none border",
        "transition-colors duration-75",
        shape === "circle" ? "rounded-full" : "rounded-none",
        SIZE_CLASSES[size],
        EMPHASIS_CLASSES[emphasis],
        "hover:bg-board-subtle/60",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-board-dark",
        "disabled:cursor-not-allowed disabled:hover:bg-transparent",
        selected && "bg-board-subtle",
        isLastMove && "after:pointer-events-none after:absolute after:inset-0 after:border after:border-board-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

export default BoardTile;
