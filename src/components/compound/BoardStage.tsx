"use client";

/**
 * The board stage — the rigid canvas every board renders inside.
 *
 * The stage exists to make one guarantee: **nothing a player does can change how
 * much room the board takes up.** Selecting a piece, hovering a destination and
 * a piece landing are all ordinary play, and each was nudging the canvas by a
 * pixel or two. That is not cosmetic — a board that resizes under the pointer
 * moves the very cell the pointer was aiming at, so a click lands on the wrong
 * square and the player blames themselves for it.
 *
 * Two boxes, not one, because the guarantee needs to be structural rather than
 * a promise each of the six board views has to keep:
 *
 *  - the **frame** is a locked square with a fixed width and `overflow-hidden`.
 *    Its geometry is computed from the viewport alone, so it cannot respond to
 *    its contents at all. This is the box that stops jitter.
 *  - the **canvas** inside it is a plain centring flex box. The board fills it
 *    and derives its own height from its own geometry — an 8x8 grid is square,
 *    Connect Four's 7x6 is 7:6 and sits centred with symmetric slack.
 *
 * The frame's padding is not decoration: it is the room the board's own drop
 * shadow needs, because `overflow-hidden` would otherwise clip it flat.
 *
 * The frame is square, with one exception. Connect Four's playfield is 7:6, and
 * a square frame around it is a sixth of wasted height on every screen — which
 * on a 360x640 phone is the difference between a board that fits and one that
 * pushes the score cards off. The ratio is named per kind rather than left to
 * the board view, because the frame has to reserve the space *before* the board
 * is measured; a board that discovered its own ratio and reported it back would
 * have already shifted everything below it by the time it did.
 *
 * The cap is `min(92vw, 620px)`. The `92vw` keeps a board off the viewport edge
 * on a 360/390/430px phone; the `620px` ceiling is the desktop size. Boards may
 * still declare a smaller cap of their own (Tic-Tac-Toe is 480px by nature), but
 * this frame is the binding constraint for the rest — a board that asked for
 * more than 620px is asking for more than the stage will hand out.
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

/** The desktop ceiling, shared with the per-board caps so they can reason
 *  about it without duplicating the number in six files. */
export const BOARD_STAGE_MAX_WIDTH = 620;

export interface BoardStageProps {
  readonly gameKind: GameKind;
  readonly size: BoardCellSize;
  /** Centred canvas treatment, applied from the 1024px breakpoint. */
  readonly isDesktop: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The frame's aspect ratio, per kind.
 *
 * One entry, read in one place, so that the ratio a board draws itself at and
 * the ratio the space was reserved for cannot drift apart. Three boards depart
 * from the square, and each for a stated reason:
 *
 *  - Connect Four is `7 / 6`: seven cells wide by six tall, so a square frame is
 *    a sixth of wasted height on every screen — on a 360x640 phone the
 *    difference between a board that fits and one that pushes the score cards
 *    off.
 *  - Hex is `10 / 7`: the rhombus is seven cells plus the six half-cell offsets
 *    the last row accumulates, so the playfield is 10 cell-widths across and 7
 *    down. A square frame here is the same bug with a different number — it left
 *    roughly 200px of dead vertical space between the last row and the bottom
 *    goal rail, which read as the board having a gap in it rather than as slack
 *    around it.
 *  - The rest are square grids.
 */
const STAGE_ASPECT_RATIO: Readonly<Record<GameKind, string>> = {
  tictactoe: "1 / 1",
  connect4: "7 / 6",
  gomoku: "1 / 1",
  reversi: "1 / 1",
  checkers: "1 / 1",
  hex: "10 / 7",
};

export function BoardStage({
  gameKind,
  size,
  isDesktop,
  children,
  className,
}: BoardStageProps): React.ReactElement {
  return (
    // The frame. `aspect-square` is set inline rather than as a utility so the
    // ratio is visible next to the `overflow-hidden` that depends on it, and so
    // the geometry reads as one deliberate decision rather than three.
    <div
      data-board-stage={gameKind}
      data-cell-size={size}
      data-desktop={isDesktop ? "true" : undefined}
      className={cn(
        "relative mx-auto w-full max-w-[min(92vw,620px)] shrink-0 overflow-hidden p-2",
        className
      )}
      style={{ aspectRatio: STAGE_ASPECT_RATIO[gameKind] }}
    >
      {/* The canvas. Nothing here sizes anything — it only centres whatever the
          board decides to be, and it stretches to the frame so a short board
          (Connect Four's 7:6) is centred against a stable height rather than
          collapsing the frame. */}
      <div className="flex h-full w-full items-center justify-center">{children}</div>
    </div>
  );
}
