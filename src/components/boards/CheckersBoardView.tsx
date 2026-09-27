"use client";

/**
 * Section 3.6 — Checkers.
 *
 * A two-tone cell grid, not an intersection board. Only the dark squares are
 * playable, and the off-play squares are rendered as recessed wells rather than
 * being left blank, so the board reads as a checkerboard at a glance and the
 * piece count is legible at a glance.
 *
 * A king is a double disc, the standard draughts convention, which is a shape
 * difference rather than a colour one — a player who cannot separate the two
 * colours can still tell a king from a pawn.
 */

import { useMemo } from "react";

import { assertBoardSnapshot, CheckersPiece, Coordinates } from "@/engine/types";
import { CHECKERS_SIZE, isPlayableSquare } from "@/engine/rules/checkers";
import { cn, formatGridSquare } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole } from "./boardViewTypes";

/** Disc diameter as a fraction of its square. The remainder is the well. */
const PIECE_RATIO = 0.82;

function Checker({ piece }: { piece: CheckersPiece }): React.ReactElement {
  const isKing = piece.type === "king";
  const isBlack = piece.color === "black";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex w-full items-center justify-center rounded-full border-2 shadow-md",
        isBlack
          ? "border-neutral-600 bg-neutral-900"
          : "border-neutral-300 bg-neutral-50"
      )}
      style={{ aspectRatio: "1 / 1" }}
    >
      {/* A king carries an inner ring; a man carries a centre pip. The two
          differ by shape, so the distinction survives a monochrome display. */}
      <span
        className={cn(
          "block rounded-full",
          isKing
            ? "w-[62%] border-2 border-dashed border-current"
            : "size-[30%]",
          isBlack ? "bg-neutral-700 text-neutral-300" : "bg-neutral-300 text-neutral-500"
        )}
      />
    </span>
  );
}

export function CheckersBoardView({
  board,
  selected,
  legalSquares,
  selectableSquares,
  destinations,
  lastMove,
  disabled,
  onSquareActivate,
  label,
  size = "md",
}: BoardViewProps): React.ReactElement {
  const state = useMemo(() => assertBoardSnapshot(board, "checkers").state, [board]);

  const roles = useMemo(() => {
    const map = new Map<string, SquareRole>();
    for (let y = 0; y < CHECKERS_SIZE; y += 1) {
      for (let x = 0; x < CHECKERS_SIZE; x += 1) {
        const coord: Coordinates = { x, y };
        map.set(
          coordKey(coord),
          squareRole(coord, { selected, legalSquares, selectableSquares, destinations, lastMove })
        );
      }
    }
    return map
  }, [selected, legalSquares, selectableSquares, destinations, lastMove]);

  return (
    <div
      role="grid"
      aria-label={label}
      aria-rowcount={CHECKERS_SIZE}
      aria-colcount={CHECKERS_SIZE}
      aria-disabled={disabled || undefined}
      className="grid w-full gap-0.5 rounded-lg border-2 border-neutral-800 p-0.5"
      style={{
        gridTemplateColumns: `repeat(${CHECKERS_SIZE}, minmax(0, 1fr))`,
        // The playable squares are dark slate and the off-play squares are
        // light slate, so the checkerboard survives even before a piece lands
        // on it. The two used to be the same near-white as the page.
        backgroundColor: "var(--color-neutral-800)",
      }}
    >
      {state.map((row, y) =>
        row.map((cell, x) => {
          const coord: Coordinates = { x, y };
          const key = coordKey(coord);
          const playable = isPlayableSquare(x, y);
          const role = roles.get(key) ?? "plain";
          const target = role === "target";

          return (
            <BoardTile
              key={key}
              label={`Square ${formatGridSquare(x, y, CHECKERS_SIZE)}${
                cell ? `, ${cell.color} ${cell.type}` : playable ? ", empty" : ", not in play"
              }`}
              size={size}
              shape="circle"
              disabled={disabled || !playable}
              selected={role === "selected"}
              isLegalTarget={target}
              isLastMove={isLastMove(lastMove, coord)}
              onClick={() => onSquareActivate(coord)}
              className={cn(
                "rounded-sm border-0 p-[9%]",
                playable
                  ? "bg-neutral-800 hover:bg-neutral-700 disabled:hover:bg-neutral-800"
                  : "bg-neutral-200",
                "disabled:cursor-not-allowed",
                lastMoveWash(role),
                role === "selected" && "bg-emerald-700",
                role === "selectable" && !disabled && "hover:bg-neutral-600",
                isLastMove(lastMove, coord) && "ring-2 ring-amber-400",
                target &&
                  playable &&
                  "after:pointer-events-none after:absolute after:inset-[24%] after:rounded-full after:border-2 after:border-emerald-400"
              )}
            >
              {cell ? (
                <Checker piece={cell} />
              ) : target && !disabled && playable ? (
                <span
                  aria-hidden="true"
                  className="block w-full animate-pulse rounded-full border-2 border-dashed border-emerald-300"
                  style={{ aspectRatio: "1 / 1" }}
                />
              ) : null}
            </BoardTile>
          );
        })
      )}
    </div>
  );
}
