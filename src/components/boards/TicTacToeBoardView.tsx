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
  targetRing,
} from "./boardViewTypes";

/** Stroke weight of an X, as a fraction of the cell box. */
const X_STROKE = 0.09;

function markerColor(color: "black" | "white"): string {
  return color === "black" ? "var(--color-board-dark)" : "var(--color-board-light)";
}

function XMarker({ color, size }: { color: "black" | "white"; size: number }): React.ReactElement {
  const inset = X_STROKE * size;
  const length = size - inset * 2;
  const half = length / 2;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none"
    >
      <g stroke={markerColor(color)} strokeWidth={X_STROKE * size} strokeLinecap="round">
        <line x1={inset} y1={inset} x2={inset + length} y2={inset + length} />
        <line x1={inset + length} y1={inset} x2={inset} y2={inset + length} />
      </g>
      <desc>{`${half} by ${half} cross`}</desc>
    </svg>
  );
}

function OMarker({ color, size }: { color: "black" | "white"; size: number }): React.ReactElement {
  const center = size / 2;
  const radius = size / 2 - X_STROKE * size * 1.6;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none"
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={markerColor(color)}
        strokeWidth={X_STROKE * size * 1.1}
      />
    </svg>
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
      className="inline-grid shrink-0 grid-cols-3 gap-px rounded-sm border border-hairline bg-hairline p-px"
    >
      {state.map((cell, index) => {
          const y = Math.floor(index / TICTACTOE_SIZE);
          const x = index % TICTACTOE_SIZE;
          const coord: Coordinates = { x, y };
          const role = roles.get(coordKey(coord)) ?? "plain";
          const isTarget = role === "target";
          const markerSize = size === "sm" ? 18 : size === "lg" ? 42 : 30;

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
                "aspect-square",
                // The hairlines live on the grid, so a tile's own border would
                // double them up and make the board look heavier than it is.
                "border-0",
                lastMoveWash(role),
                targetRing(role)
              )}
            >
              {cell === "black" ? (
                <XMarker color="black" size={markerSize} />
              ) : cell === "white" ? (
                <OMarker color="white" size={markerSize} />
              ) : isTarget ? (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-board-muted/50"
                />
              ) : null}
            </BoardTile>
          );
      })}
    </div>
  );
}
