"use client";

/**
 * Section 3.6 — Checkers.
 *
 * A two-tone cell grid, not an intersection board. Only the four dark squares
 * are playable, and the off-play squares are rendered as recessed wells rather
 * than being left blank, so the board reads as a checkerboard at a glance and
 * the piece count is legible at a glance.
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
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole, targetRing } from "./boardViewTypes";

const PIECE_RATIO = 0.76;

function Checker({
  piece,
  size,
}: {
  piece: CheckersPiece;
  size: "sm" | "md" | "lg";
}): React.ReactElement {
  const isKing = piece.type === "king";
  const face = piece.color === "black" ? "border-board-dark bg-board-dark" : "border-board-light bg-board-light";
  // A ring on a dark disc is invisible, so the king is distinguished by size
  // and by the crown bar rather than by an outline.
  const detail = piece.color === "black" ? "bg-board-light" : "bg-board-dark";
  const innerSize = isKing ? (size === "sm" ? 8 : size === "lg" ? 22 : 15) : size === "sm" ? 6 : size === "lg" ? 16 : 11;

  return (
    <span
      aria-hidden="true"
      className="relative flex items-center justify-center"
      style={{ width: `${PIECE_RATIO * 100}%`, aspectRatio: "1 / 1" }}
    >
      <span className={cn("absolute inset-0 rounded-full border shadow-[inset_0_-2px_3px_rgba(0,0,0,0.25)]", face)} />
      {isKing ? (
        <span
          className={cn("relative rounded-full border-2", detail, "border-transparent")}
          style={{ width: `${innerSize * 2}px`, height: `${innerSize * 2}px` }}
        />
      ) : null}
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
    return map;
  }, [selected, legalSquares, selectableSquares, destinations, lastMove]);

  return (
    <div
      role="grid"
      aria-label={label}
      aria-rowcount={CHECKERS_SIZE}
      aria-colcount={CHECKERS_SIZE}
      aria-disabled={disabled || undefined}
      className="inline-grid shrink-0 gap-1 rounded-md border border-board-muted bg-board-light p-1"
      style={{
        gridTemplateColumns: `repeat(${CHECKERS_SIZE}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${CHECKERS_SIZE}, minmax(0, 1fr))`,
      }}
    >
      {state.map((row, y) =>
        row.map((cell, x) => {
          const coord: Coordinates = { x, y };
          const playable = isPlayableSquare(x, y);
          const role = roles.get(coordKey(coord)) ?? "plain";
          const target = role === "target";
          const key = coordKey(coord);

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
                "aspect-square border-0",
                playable
                  ? "bg-board-dark/90"
                  : "bg-board-dark/[0.06] shadow-[inset_0_1px_2px_rgba(0,0,0,0.10)]",
                lastMoveWash(role),
                targetRing(role)
              )}
            >
              {cell ? (
                <Checker piece={cell} size={size} />
              ) : target && !disabled && playable ? (
                <span
                  aria-hidden="true"
                  className="block rounded-full border-2 border-dashed border-board-light/70"
                  style={{ width: `${PIECE_RATIO * 100}%`, aspectRatio: "1 / 1" }}
                />
              ) : null}
            </BoardTile>
          );
        })
      )}
    </div>
  );
}
