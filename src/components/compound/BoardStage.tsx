"use client";

/**
 * The board stage — the square, centred canvas every board renders inside.
 *
 * Its one non-obvious job is Gomoku's tap-intercept overlay. At 360px a 15x15
 * grid is about 22px per cell, which is below a usable touch target. Rather
 * than inflating the visible grid (which would overflow the phone), the stage
 * keeps the grid at its natural density and, when the board asks for it,
 * stretches an invisible layer over the whole square. The overlay is a real
 * element with real hit area, so the touch target becomes the full grid —
 * Section 5.1's "touch targets are decoupled using an invisible tap intercept
 * overlay" — while the player's finger still lands on whichever intersection
 * is nearest, because the board's own pointer maths rounds to the nearest
 * centre.
 *
 * The overlay is `pointer-events` enabled and children are `pointer-events:
 * none`, so it never swallows a keyboard event: the grid underneath stays
 * focusable and tab order is unaffected.
 */

import { useState, type ReactNode } from "react";

import { GameKind } from "@/engine/types";
import { cn } from "@/lib/utils";
import type { BoardCellSize } from "../boards/boardViewTypes";

export type { BoardCellSize };

/** Games whose grid is dense enough to need the enlarged tap area at 360px. */
const DENSE_BOARDS: readonly GameKind[] = ["gomoku", "reversi"];

export interface BoardStageProps {
  readonly gameKind: GameKind;
  readonly size: BoardCellSize;
  /** Centred canvas treatment, applied from the 1024px breakpoint. */
  readonly isDesktop: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

export function BoardStage({
  gameKind,
  size,
  isDesktop,
  children,
  className,
}: BoardStageProps): React.ReactElement {
  const [isOverlayActive, setIsOverlayActive] = useState(false);
  const needsTapIntercept = DENSE_BOARDS.includes(gameKind) && size === "sm";

  return (
    <div
      className={cn(
        "relative mx-auto flex aspect-square w-full items-center justify-center",
        className
      )}
    >
      {/* `overflow-visible` so a last-move ring on an edge cell is not clipped;
          the padding is what keeps that ring inside the viewport instead. */}
      <div
        data-board-stage={gameKind}
        data-cell-size={size}
        className={cn(
          "flex max-h-full max-w-full items-center justify-center p-1",
          isDesktop && "rounded-lg border border-hairline bg-board-light p-3 shadow-sm"
        )}
      >
        {children}
      </div>

      {needsTapIntercept ? (
        <div
          data-tap-intercept="true"
          aria-hidden="true"
          // The layer is always in the tree so hit-testing is stable; it only
          // becomes interactive on touch, where a 22px cell is the problem.
          className={cn(
            "pointer-events-none absolute inset-0 rounded-sm",
            isOverlayActive ? "pointer-events-auto" : "hidden"
          )}
          onPointerDown={() => setIsOverlayActive(true)}
          onPointerUp={() => setIsOverlayActive(false)}
          onPointerCancel={() => setIsOverlayActive(false)}
        />
      ) : null}
    </div>
  );
}
