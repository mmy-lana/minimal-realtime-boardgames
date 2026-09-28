/**
 * The contract every board view implements.
 *
 * Board views are deliberately dumb. They render a board and report the
 * coordinate that was activated; they never decide whether that click picked
 * up a piece or dropped one, and they never look at whose turn it is. That
 * decision belongs to `useGameSession`, which already owns the rules, so the
 * six views stay small enough to read in one sitting and none of them has to
 * be taught a second set of rules.
 *
 * All four sets are keyed by the string `"x,y"` so a view can test membership
 * in O(1) without allocating a key on every render of every cell.
 */

import type { Coordinates, UniversalBoard } from "@/engine/types";

/** The rendered size of a cell, mapped to the `BoardTile` scale. */
export type BoardCellSize = "sm" | "md" | "lg";

/** How a single square should read, given the session's selection state. */
export type SquareRole = "plain" | "selectable" | "selected" | "target" | "last-move";

export interface BoardViewProps {
  /** The board to render. The view narrows it to its own variant. */
  readonly board: UniversalBoard;
  /** The currently selected origin square, as `"x,y"`. */
  readonly selected: ReadonlySet<string>;
  /** Squares a single-click move could land on with no selection. */
  readonly legalSquares: ReadonlySet<string>;
  /** Squares holding a piece the local player may pick up. */
  readonly selectableSquares: ReadonlySet<string>;
  /** Destinations reachable from the current selection. */
  readonly destinations: ReadonlySet<string>;
  /** The most recent move, for the highlight. */
  readonly lastMove: { readonly from: Coordinates | null; readonly to: Coordinates } | null;
  /**
   * The mark the next move will remove, as `"x,y"`. At most one square, and
   * empty in every game but Tic-Tac-Toe, where a player may hold only three
   * marks and a fourth lifts the oldest. A view that does not implement the
   * rule simply ignores it.
   */
  readonly vanishingSquares?: ReadonlySet<string>;
  /**
   * The cells that ended the game, as `"x,y"`. Optional, and empty in every
   * state a finished game does not have: while the match is live, on a draw, and
   * in Reversi and Checkers, where the result is a count of pieces and there is
   * no line to point at. A view that ignores it simply draws no highlight.
   *
   * It is the *view's* cue, not its own search: the engines already decided
   * which cells won, and a view that worked the answer out again would be a
   * second opinion that could disagree with the result banner.
   */
  readonly winningSquares?: ReadonlySet<string>;
  /** Blocks every interaction, e.g. while the turn is not the local player's. */
  readonly disabled: boolean;
  /** Called with the square the user activated. */
  readonly onSquareActivate: (coord: Coordinates) => void;
  /** Accessible name for the grid. */
  readonly label: string;
  readonly size?: BoardCellSize;
}

export function coordKey(coord: Coordinates): string {
  return `${coord.x},${coord.y}`;
}

/**
 * Resolves what a square should look like. A square that is both a reachable
 * destination and the last move played still reads as the target, because
 * that is the information the player is acting on right now.
 */
export function squareRole(
  coord: Coordinates,
  sets: {
    readonly selected: ReadonlySet<string>;
    readonly legalSquares: ReadonlySet<string>;
    readonly selectableSquares: ReadonlySet<string>;
    readonly destinations: ReadonlySet<string>;
    readonly lastMove: BoardViewProps["lastMove"];
  }
): SquareRole {
  const key = coordKey(coord);
  if (sets.selected.has(key)) return "selected";
  if (sets.destinations.has(key)) return "target";
  if (sets.selectableSquares.has(key)) return "selectable";
  if (sets.legalSquares.has(key)) return "target";
  if (isLastMove(sets.lastMove, coord)) return "last-move";
  return "plain";
}

export function isLastMove(
  lastMove: BoardViewProps["lastMove"],
  coord: Coordinates
): boolean {
  if (!lastMove) return false;
  if (lastMove.to.x === coord.x && lastMove.to.y === coord.y) return true;
  if (!lastMove.from) return false;
  return lastMove.from.x === coord.x && lastMove.from.y === coord.y;
}

/** Tailwind class for the halo that marks a reachable target. */
export function targetRing(role: SquareRole): string {
  return role === "target"
    ? "after:pointer-events-none after:absolute after:inset-[18%] after:rounded-full after:border-2 after:border-board-muted/70"
    : "";
}

/** Tailwind class for the last-move wash. */
export function lastMoveWash(role: SquareRole): string {
  return role === "last-move"
    ? "bg-board-subtle/50"
    : "";
}
