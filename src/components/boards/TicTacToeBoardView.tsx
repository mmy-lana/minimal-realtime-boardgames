"use client";

/**
 * Section 3.2 — Tic-Tac-Toe.
 *
 * A dense hairline grid with tactile SVG markers: the X is two strokes and
 * the O is a stroked ring rather than a filled blob, so an O stays legible
 * against both the light and dark cell variants and neither colour relies on
 * fill alone.
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

/**
 * Board palette. The two-tone checkerboard is what carries the grid lines: a
 * `board-light` grid on a `board-light` page has no edge and no internal
 * structure, which is why this board used to read as nine loose marks floating
 * in whitespace. The alternating fills and the dark frame give the grid a
 * boundary without a single hairline.
 */
const CELL_LIGHT = "bg-white";
const CELL_DARK = "bg-neutral-200";
const FRAME = "border-2 border-neutral-900";

/** Stroke weight of a mark, as a fraction of the cell box. */
const X_STROKE = 0.09;

function markerColor(color: "black" | "white"): string {
  return color === "black" ? "var(--color-board-dark)" : "var(--color-board-light)";
}

/**
 * An X or an O, drawn inside a 100x100 viewBox and scaled by the cell.
 *
 * The old markers took a pixel `size` and were centred in a 32px tile, so they
 * could not respond to the tile growing. Taking a *ratio* of the cell instead
 * means one number describes every viewport: the mark is always the same
 * proportion of its square, and the square is always the size the grid gives
 * it. The `X` is two strokes and the `O` is a stroked ring rather than a
 * filled blob, so neither colour relies on fill alone to stay legible against
 * the light and the dark cell variants.
 */
function Marker({ color, ratio }: { color: "black" | "white"; ratio: number }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="block"
      style={{ width: `${ratio * 100}%`, aspectRatio: "1 / 1" }}
    >
      <svg viewBox="0 0 100 100" className="size-full" focusable="false">
        {color === "black" ? (
          <g stroke={markerColor(color)} strokeWidth={X_STROKE * 100} strokeLinecap="round">
            <line x1={X_STROKE * 50} y1={X_STROKE * 50} x2={100 - X_STROKE * 50} y2={100 - X_STROKE * 50} />
            <line x1={100 - X_STROKE * 50} y1={X_STROKE * 50} x2={X_STROKE * 50} y2={100 - X_STROKE * 50} />
          </g>
        ) : (
          <circle
            cx={50}
            cy={50}
            r={50 - X_STROKE * 100 * 0.8}
            fill="none"
            stroke={markerColor(color)}
            strokeWidth={X_STROKE * 100}
          />
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
      className={cn(
        "grid w-full gap-1.5 p-1.5",
        FRAME,
        "bg-neutral-900",
        "grid-cols-3"
      )}
    >
      {state.map((cell, index) => {
          const y = Math.floor(index / TICTACTOE_SIZE);
          const x = index % TICTACTOE_SIZE;
          const coord: Coordinates = { x, y };
          const role = roles.get(coordKey(coord)) ?? "plain";
          const isTarget = role === "target";
          // The markers are sized in the cell's own units rather than in
          // pixels, so a 3x3 grid and a 15x15 one both draw a proportional
          // mark. A fixed pixel size is what made the X a 18px speck on a
          // board that is 180px across.
          const markerRatio = size === "sm" ? 0.5 : size === "lg" ? 0.68 : 0.6;

          return (
            <BoardTile
              key={coordKey(coord)}
              label={`Square ${formatCoordinate(coord.x, coord.y)}${
                cell ? `, ${cell === "black" ? "black" : "white"} mark` : ", empty"
              }`}
              size={size}
              disabled={disabled}
              selected={role === "selected"}
              isLegalTarget={isTarget}
              isLastMove={isLastMove(lastMove, coord)}
              onClick={() => onSquareActivate(coord)}
              className={cn(
                // The checkerboard alternation carries the grid lines, so the
                // tile needs no border of its own.
                "rounded-sm border-0",
                (x + y) % 2 === 0 ? CELL_DARK : CELL_LIGHT,
                "hover:bg-neutral-100",
                "disabled:hover:bg-inherit",
                role === "selected" && "bg-neutral-300",
                lastMoveWash(role),
                // The ring is a solid dot rather than a dashed ghost: at 3x3 the
                // squares are large and a hollow marker read as debris.
                isTarget && "after:pointer-events-none after:absolute after:inset-[38%] after:rounded-full after:bg-neutral-400"
              )}
            >
              {cell === "black" ? (
                <Marker color="black" ratio={markerRatio} />
              ) : cell === "white" ? (
                <Marker color="white" ratio={markerRatio} />
              ) : null}
            </BoardTile>
          );
      })}
    </div>
  );
}
