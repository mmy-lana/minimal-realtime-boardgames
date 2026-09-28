"use client";

/**
 * Section 3.2 — Tic-Tac-Toe.
 *
 * The grid is drawn by the gap, not by the cells. Each tile is a flat
 * `neutral-100` square and the 12px of `neutral-900` between them is the line —
 * which means a tile has no border at all and nothing about its own appearance
 * can change its size. The earlier checkerboard did the opposite: it alternated
 * two fills to imply the grid, and the two-tone pattern is the reason a
 * tic-tac-toe board has historically read as nine loose marks rather than as
 * one board.
 *
 * Marks are SVG in a 100x100 viewBox, taking 65% of their cell. Sizing them as
 * a ratio rather than in pixels means one number describes every viewport, and
 * the mark is always the same weight relative to the square holding it.
 *
 * The colours are literal hexes on purpose. The marks used to be
 * `board-dark` and `board-light`, which is a token pair chosen to contrast with
 * a *page* background — and this board's cells are `neutral-100`, a light
 * neutral. The white mark was a white mark on a light cell, and it was simply
 * not there. `#111827` and `#DC2626` are both dark enough to clear 4.5:1
 * against `neutral-100` on their own, with no dependency on which token a
 * theme happens to resolve to.
 */

import { useMemo } from "react";

import { assertBoardSnapshot, Coordinates, type TicTacToeBoard } from "@/engine/types";
import { TICTACTOE_SIZE } from "@/engine/rules/tictactoe";
import { formatCoordinate } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import { cn } from "@/lib/utils";
import {
  BoardViewProps,
  coordKey,
  isLastMove,
  lastMoveWash,
  SquareRole,
  squareRole,
} from "./boardViewTypes";

/** Cell fill. One colour for all nine squares — the gap draws the grid. */
const CELL = "bg-neutral-100";

/**
 * Marks are 65% of their cell. A mark that is a larger share of the square
 * reads as drawn *in* the square; much smaller and it reads as debris sitting
 * on top of it.
 */
const MARKER_RATIO = 0.65;

/**
 * Stroke weight in the 100x100 viewBox. The endpoints are inset by half the
 * stroke (`STROKE / 2`) so the round caps end exactly on the 0 and 100
 * guides — without that the mark overhangs its own box and neighbouring marks
 * crowd each other in the middle of the board.
 */
const STROKE = 12;
const INSET = STROKE / 2;

const X_COLOR = "#111827";
const O_COLOR = "#DC2626";

/**
 * An X or an O, drawn in a 100x100 viewBox and scaled by its cell.
 *
 * The `X` is two strokes and the `O` is a stroked ring rather than a filled
 * blob, so neither relies on fill alone to stay legible.
 */
function Marker({ color }: { color: "black" | "white" }): React.ReactElement {
  const stroke = color === "black" ? X_COLOR : O_COLOR;
  return (
    <span
      aria-hidden="true"
      className="block"
      style={{ width: `${MARKER_RATIO * 100}%`, aspectRatio: "1 / 1" }}
    >
      <svg viewBox="0 0 100 100" className="size-full" focusable="false">
        {color === "black" ? (
          <g stroke={stroke} strokeWidth={STROKE} strokeLinecap="round">
            <line x1={INSET} y1={INSET} x2={100 - INSET} y2={100 - INSET} />
            <line x1={100 - INSET} y1={INSET} x2={INSET} y2={100 - INSET} />
          </g>
        ) : (
          <circle cx={50} cy={50} r={50 - INSET} fill="none" stroke={stroke} strokeWidth={STROKE} />
        )}
      </svg>
    </span>
  );
}

export function TicTacToeBoardView({
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
  const state: TicTacToeBoard = useMemo(
    () => assertBoardSnapshot(board, "tictactoe").state,
    [board]
  );

  const roles = useMemo(() => {
    const map = new Map<string, SquareRole>();
    for (let y = 0; y < TICTACTOE_SIZE; y += 1) {
      for (let x = 0; x < TICTACTOE_SIZE; x += 1) {
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
      aria-disabled={disabled || undefined}
      // A square board, and 480px: tic-tac-toe is nine cells and grows past
      // that by getting airier, not larger. A wider board just spreads the
      // marks further apart and makes the centre — where the game is decided —
      // harder to take in at once.
      className="grid w-full max-w-[480px] grid-cols-3 gap-3 rounded-xl border-4 border-neutral-900 bg-neutral-900 p-3 shadow-xl"
      style={{ aspectRatio: "1 / 1" }}
    >
      {state.map((cell, index) => {
        const y = Math.floor(index / TICTACTOE_SIZE);
        const x = index % TICTACTOE_SIZE;
        const coord: Coordinates = { x, y };
        const role = roles.get(coordKey(coord)) ?? "plain";

        return (
          <BoardTile
            key={coordKey(coord)}
            label={`Square ${formatCoordinate(coord.x, coord.y)}${
              cell ? `, ${cell === "black" ? "black" : "white"} mark` : ", empty"
            }`}
            size={size}
            disabled={disabled}
            selected={role === "selected"}
            isLegalTarget={role === "target"}
            isLastMove={isLastMove(lastMove, coord)}
            onClick={() => onSquareActivate(coord)}
            className={cn(
              "h-full w-full rounded-lg",
              CELL,
              "hover:bg-white",
              "disabled:hover:bg-neutral-100",
              role === "selected" && "bg-neutral-300",
              lastMoveWash(role)
              // No `after:` marker here. BoardTile already paints the legal
              // target, and a view painting its own would put two competing
              // sets of `after:` utilities on one pseudo-element.
            )}
          >
            {cell !== null ? <Marker color={cell} /> : null}
          </BoardTile>
        );
      })}
    </div>
  );
}
