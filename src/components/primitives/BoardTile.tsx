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
  /**
   * Replaces the selection ring outright — it is not merged with the default.
   *
   * Checkers wants an amber ring at a different weight; chess wants a gold one.
   * Both used to be passed through `className`, which leaves two `ring-*`
   * utilities on one element, and the winner is decided by stylesheet order
   * rather than by intent — so a selection ring could appear on some viewports
   * and not others. A prop can only take the one value it is given.
   */
  selectedRingClass?: string;
  /**
   * Replaces the legal-target marker outright, for the same reason as
   * `selectedRingClass`. Chess wants a filled green dot; Reversi wants a ghost
   * disc.
   *
   * **Every utility must carry the `after:` prefix.** These classes go onto the
   * marker's pseudo-element, but the component emits them verbatim, and a
   * `border-2` written without its prefix lands on the tile itself — which is
   * the one thing a tile may never carry, and the reason the board suite fails
   * a view whose marker is written this way.
   */
  targetDotClass?: string;
  children?: React.ReactNode;
}

/**
 * Minimum edge length per preset. These are floors, not fixed sizes: a tile
 * grows to fill its grid cell (`w-full` + `aspect-square`) and only refuses to
 * shrink below the value here.
 *
 * The old values (`size-[22px]`, `size-8`, `size-11`) were *fixed*, so a board
 * was exactly as big as its cell preset no matter how much room the layout had
 * — which is what made a Chess board render as a postage stamp inside an
 * unbounded viewport. Making the preset a floor instead means one board
 * definition serves a 360px phone and a 4K display, and the floor still keeps a
 * cell from collapsing below a usable tap size on a dense grid.
 */
const SIZE_CLASSES: Record<BoardTileSize, string> = {
  sm: "min-h-[22px]",
  md: "min-h-8",
  lg: "min-h-11",
};

/**
 * Emphasis is a ring, not a border.
 *
 * A border is part of the element's box model: a 1px border and a 2px border
 * are two different sizes, and toggling between them at click time is exactly
 * the pixel of jitter this component exists to prevent. A ring is a
 * `box-shadow` painted outside — or, with `ring-inset`, inside — the border
 * box, so it changes what a tile *looks* like without changing what it
 * *measures*. No state below may set `border-width`.
 */
const EMPHASIS_CLASSES: Record<BoardTileEmphasis, string> = {
  none: "",
  subtle: "ring-1 ring-inset ring-board-border",
  strong: "ring-1 ring-inset ring-board-dark",
};

/**
 * The default selection and last-move rings, and the default target marker.
 *
 * The marker is a filled dot rather than a ring. A ring needs a border on the
 * pseudo-element, and a `border-*` utility is indistinguishable, to a grep and
 * to the box-model test, from a border on the tile itself — which is the one
 * thing a tile may never carry. A fill has no such ambiguity, and it is the
 * stronger signal at small sizes: on a phone a hollow ring one-third the width
 * of a square is three faint hairlines, where a solid dot is a dot.
 */
const DEFAULT_SELECTED_RING = "ring-2 ring-inset ring-board-dark";
const LAST_MOVE_RING = "ring-2 ring-inset ring-amber-400/80";
const DEFAULT_TARGET_DOT = "after:bg-board-dark/60";

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
  selectedRingClass,
  targetDotClass,
  className,
  children,
  onContextMenu,
  onDragStart,
  type,
  ...rest
}: BoardTileProps) {
  // Exactly one ring, chosen in one place.
  //
  // Two `ring-*` utilities on the same element are a CSS conflict whose winner
  // is decided by stylesheet order, not by the order the classes appear in the
  // attribute — so a selection ring could be silently overridden by an
  // emphasis ring and the tile would look different at different viewport
  // widths. Picking one here makes the result deterministic by construction,
  // and the two override props *replace* the default rather than joining it.
  const ringClass = selected
    ? (selectedRingClass ?? DEFAULT_SELECTED_RING)
    : isLastMove
      ? LAST_MOVE_RING
      : EMPHASIS_CLASSES[emphasis];

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
        "relative inline-flex w-full aspect-square shrink-0 items-center justify-center",
        "select-none overflow-hidden",
        "transition-colors duration-75",
        shape === "circle" ? "rounded-full" : "rounded-none",
        SIZE_CLASSES[size],
        ringClass,
        "hover:bg-board-subtle/60",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-board-dark",
        "disabled:cursor-not-allowed disabled:hover:bg-transparent",
        // A legal destination is a dot painted on top of the tile, drawn with
        // an absolutely positioned pseudo-element. It never consumes layout
        // space, so revealing it cannot reflow the board.
        isLegalTarget && "after:pointer-events-none after:absolute after:inset-[30%] after:rounded-full",
        isLegalTarget && (targetDotClass ?? DEFAULT_TARGET_DOT),
        className,
      )}
    >
      {children}
    </button>
  );
}

export default BoardTile;
