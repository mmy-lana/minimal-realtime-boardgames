"use client";

/**
 * The board stage — the centred canvas every board renders inside.
 *
 * Its one job is sizing, and it owns that job outright. Each board is a CSS
 * grid whose tiles are `w-full aspect-square`, so a board's height falls out of
 * its width and its column count: an 8x8 grid is square, Connect Four's 7x6 is
 * 7:6. The stage therefore only has to decide how *wide* a board may get, and
 * it decides that in one place so the six board definitions never have to carry
 * viewport logic of their own.
 *
 * The cap is `min(92vw, 34rem)`. The `92vw` keeps a board off the viewport edge
 * on a 360/390/430px phone; the `34rem` ceiling is what stops a desktop board
 * from growing without bound, which is the other half of the bug this replaces
 * — boards used to be pinned to a fixed cell size inside an unbounded column,
 * so they rendered postage-stamp sized in the middle of a large screen.
 *
 * The old invisible tap-intercept overlay is gone. It became interactive on
 * `pointerdown` and stayed that way until `pointerup`, so the click it was
 * meant to enlarge landed on the overlay and the cell underneath never saw it
 * — the first tap of a dense board was swallowed rather than enlarged. Boards
 * now hit-test on the cell itself, which is the whole grid at full size.
 */

import type { ReactNode } from "react";

import { GameKind } from "@/engine/types";
import { cn } from "@/lib/utils";
import type { BoardCellSize } from "../boards/boardViewTypes";

export type { BoardCellSize };

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
  return (
    <div
      data-board-stage={gameKind}
      data-cell-size={size}
      className={cn(
        "mx-auto w-full max-w-[min(92vw,34rem)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
