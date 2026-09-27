"use client";

/**
 * Section 3.4 — Gomoku, 15x15.
 *
 * Stones sit on intersections, not in cells, so the visible grid is drawn as a
 * background of hairlines *offset by half a cell* — that puts every line exactly
 * where a stone is centred, which is what makes the board look like a go board
 * rather than graph paper. Each cell is also a control, so the hit area is the
 * whole cell and never the 22px square the stone itself occupies.
 *
 * Hit-testing maps a pointer to the nearest intersection before it is reported.
 * Aiming at a line crossing and getting that crossing is what makes a 15x15
 * board usable with a fingertip, and rounding to the nearest centre — rather
 * than trusting whatever subpixel the browser reports — is what keeps the stone
 * and the line it lands on together on a high-DPI screen.
 */

import { useMemo, useRef, useState } from "react";

import { assertBoardSnapshot, Coordinates } from "@/engine/types";
import { GOMOKU_SIZE } from "@/engine/rules/gomoku";
import { cn, formatGridSquare } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole } from "./boardViewTypes";

function Stone({ color }: { color: "black" | "white" }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block w-full rounded-full border shadow-md",
        color === "black"
          ? "border-neutral-900 bg-neutral-950"
          : "border-neutral-400 bg-neutral-50"
      )}
      style={{ aspectRatio: "1 / 1" }}
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

  /**
   * Maps a pointer event to the nearest intersection.
   *
   * The `- 0.5` is what snaps cell *centres* to their own index: without it the
   * line drawn at the centre of cell `n` would resolve to intersection `n - 1`,
   * and every stone would appear one line off from the grid it was played on.
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
      className="grid w-full gap-0 rounded-md border-2 border-neutral-800 bg-[#e3b866] p-1 shadow-md"
      style={{
        gridTemplateColumns: `repeat(${GOMOKU_SIZE}, minmax(0, 1fr))`,
        // Two 1px lines per axis, tiled every cell and offset by half a cell so
        // each line lands on an intersection rather than on a cell boundary.
        // The outer half-cell on the right and bottom is closed by the frame.
        backgroundImage:
          "linear-gradient(to right, var(--color-neutral-800) 1px, transparent 1px), linear-gradient(to bottom, var(--color-neutral-800) 1px, transparent 1px)",
        backgroundSize: `${100 / GOMOKU_SIZE}% ${100 / GOMOKU_SIZE}%`,
        backgroundPosition: `${100 / (GOMOKU_SIZE * 2)}% ${100 / (GOMOKU_SIZE * 2)}%`,
      }}
    >
      {state.map((row, y) =>
        row.map((cell, x) => {
          const coord: Coordinates = { x, y };
          const key = coordKey(coord);
          const role = roles.get(key) ?? "plain";
          const target = role === "target";
          const latest = isLastMove(lastMove, coord);
          // The ghost only previews where the pointer genuinely is, so it never
          // implies a move the player is not making.
          const showGhost = !disabled && cell === null && target && hovered?.x === x && hovered?.y === y;

          return (
            <BoardTile
              key={key}
              label={`${formatGridSquare(x, y, GOMOKU_SIZE)}${cell ? `, ${cell} stone` : ", empty"}`}
              size={size}
              shape="circle"
              disabled={disabled}
              selected={role === "selected"}
              isLegalTarget={target}
              isLastMove={latest}
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
              onPointerLeave={() =>
                setHovered((current) => (current?.x === x && current.y === y ? null : current))
              }
              className={cn(
                "border-0 bg-transparent",
                // A stone is inset so it clears the crossing it sits on.
                "p-[18%]",
                "hover:bg-amber-600/20",
                "disabled:hover:bg-transparent",
                lastMoveWash(role),
                selected && "bg-amber-500/25",
                latest && "after:pointer-events-none after:absolute after:inset-[12%] after:rounded-full after:border after:border-emerald-600",
                target &&
                  "after:pointer-events-none after:absolute after:inset-[18%] after:rounded-full after:border-2 after:border-emerald-600"
              )}
            >
              {cell !== null ? (
                <Stone color={cell} />
              ) : showGhost ? (
                <span
                  aria-hidden="true"
                  className="block w-full animate-pulse rounded-full border-2 border-dashed border-neutral-700"
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
