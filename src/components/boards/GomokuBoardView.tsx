"use client";

/**
 * Section 3.4 — Gomoku, 15x15.
 *
 * Stones sit on intersections, not in cells, so the grid is drawn as a CSS
 * background of hairlines and the hit targets are the same squares offset by
 * half a cell. At 360px a cell is roughly 22px, well under the 44px touch
 * guideline, so each stone sits inside an invisible padded hit area: the
 * visible board stays dense while the tappable region is a full grid cell.
 */

import { useMemo, useRef, useState } from "react";

import { assertBoardSnapshot, Coordinates } from "@/engine/types";
import { GOMOKU_SIZE } from "@/engine/rules/gomoku";
import { cn, formatGridSquare } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole, targetRing } from "./boardViewTypes";

const STONE_RATIO = 0.78;

function Stone({ color }: { color: "black" | "white" }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block rounded-full border shadow-[inset_0_-1px_2px_rgba(0,0,0,0.18)]",
        color === "black" ? "border-board-dark bg-board-dark" : "border-board-light bg-board-light"
      )}
      style={{ width: `${STONE_RATIO * 100}%`, aspectRatio: "1 / 1" }}
    />
  );
}

export function GomokuBoardView({
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
  const state = useMemo(() => assertBoardSnapshot(board, "gomoku").state, [board]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<Coordinates | null>(null);

  const roles = useMemo(() => {
    const map = new Map<string, SquareRole>();
    for (let y = 0; y < GOMOKU_SIZE; y += 1) {
      for (let x = 0; x < GOMOKU_SIZE; x += 1) {
        const coord: Coordinates = { x, y };
        map.set(
          coordKey(coord),
          squareRole(coord, { selected, legalSquares, selectableSquares, destinations, lastMove })
        );
      }
    }
    return map;
  }, [selected, legalSquares, selectableSquares, destinations, lastMove]);

  const isTarget = (x: number, y: number): boolean => roles.get(`${x},${y}`) === "target";

  /**
   * Maps a pointer event to the nearest intersection. Rounding to the nearest
   * centre is what makes a 15x15 board usable with a fingertip: the player aims
   * at a line crossing, not at a 22px square, and gets the intersection.
   */
  const coordFromEvent = (event: { clientX: number; clientY: number }): Coordinates | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const bounds = grid.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    const relativeX = event.clientX - bounds.left;
    const relativeY = event.clientY - bounds.top;
    const cellWidth = bounds.width / GOMOKU_SIZE;
    const cellHeight = bounds.height / GOMOKU_SIZE;
    const x = Math.round(relativeX / cellWidth - 0.5);
    const y = Math.round(relativeY / cellHeight - 0.5);
    if (x < 0 || y < 0 || x >= GOMOKU_SIZE || y >= GOMOKU_SIZE) return null;
    return { x, y };
  };

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={label}
      aria-rowcount={GOMOKU_SIZE}
      aria-colcount={GOMOKU_SIZE}
      aria-disabled={disabled || undefined}
      className="relative inline-grid shrink-0 rounded-sm bg-board-light"
      style={{
        gridTemplateColumns: `repeat(${GOMOKU_SIZE}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${GOMOKU_SIZE}, minmax(0, 1fr))`,
        // A single background draws every line at once. The two-tone gradient
        // puts the wood-grain warmth on the odd lines and leaves the rest
        // clean, which reads as a board rather than as graph paper.
        backgroundImage:
          "linear-gradient(to right, var(--color-hairline) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hairline) 1px, transparent 1px)",
        backgroundSize: `${100 / GOMOKU_SIZE}% ${100 / GOMOKU_SIZE}%`,
        backgroundPosition: "0 0",
        border: "1px solid var(--color-board-muted)",
      }}
    >
      {state.map((row, y) =>
        row.map((cell, x) => {
          const coord: Coordinates = { x, y };
          const role = roles.get(coordKey(coord)) ?? "plain";
          const target = role === "target";
          // The ghost only previews when the pointer is genuinely over the
          // board, so it never implies a move the player is not making.
          const showGhost =
            !disabled && cell === null && target && (hovered?.x === x && hovered?.y === y);

          return (
            <BoardTile
              key={coordKey(coord)}
              label={`${formatGridSquare(x, y, GOMOKU_SIZE)}${cell ? `, ${cell} stone` : ", empty"}`}
              size={size}
              shape="circle"
              disabled={disabled}
              selected={role === "selected"}
              isLegalTarget={target}
              isLastMove={isLastMove(lastMove, coord)}
              onClick={(event) => {
                const aimed = coordFromEvent(event);
                onSquareActivate(aimed ?? coord);
              }}
              onPointerMove={(event) => {
                if (disabled) return;
                const aimed = coordFromEvent(event);
                setHovered((current) =>
                  current?.x === aimed?.x && current?.y === aimed?.y ? current : aimed
                );
              }}
              onPointerLeave={() => setHovered((current) => (current?.x === x && current.y === y ? null : current))}
              className={cn(
                "aspect-square border-0 bg-transparent",
                lastMoveWash(role),
                // The intersection sits at the centre of the cell, so the stone
                // is inset by half a cell rather than centred in it.
                "p-[calc(50%-var(--gomoku-stone)/2)] [--gomoku-stone:0.78rem]",
                targetRing(role)
              )}
            >
              {cell !== null ? (
                <Stone color={cell} />
              ) : showGhost ? (
                <span
                  aria-hidden="true"
                  className="block rounded-full border-2 border-dashed border-board-muted"
                  style={{ width: `${STONE_RATIO * 100}%`, aspectRatio: "1 / 1" }}
                />
              ) : null}
            </BoardTile>
          );
        })
      )}
    </div>
  );
}
