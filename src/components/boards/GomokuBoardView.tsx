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
 * **No per-cell markers.** Every empty intersection on a 15x15 Gomoku board is
 * a legal move, so the board carries ~225 of them. Rendering a marker per legal
 * square put ~225 green rings on screen, which buried the grid lines and left
 * the board looking like a spreadsheet rather than a go board. The rule here is
 * that a square is only ever decorated for a *specific* square the player is
 * acting on:
 *
 *  - the one intersection currently under the pointer gets a ghost stone;
 *  - the one stone just played gets a small contrasting pip.
 *
 * Two markers per board, both traditional, and every other square is left alone.
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
import { coordKey, isLastMove, SquareRole, squareRole } from "./boardViewTypes";

/** The board's wood, and the ink its grid is drawn in. */
const WOOD = "bg-[#DCB35C]";
const LINE = "#4A3718";

/**
 * Hoshi — the traditional star points. They sit on the same five intersections
 * on every board size, so they are derived from the centre rather than written
 * as literals.
 */
const HOSHI: ReadonlySet<string> = new Set([
  coordKey({ x: 3, y: 3 }),
  coordKey({ x: 11, y: 3 }),
  coordKey({ x: 7, y: 7 }),
  coordKey({ x: 3, y: 11 }),
  coordKey({ x: 11, y: 11 }),
]);

/**
 * A stone is 84% of the intersection spacing.
 *
 * Sizing it as a percentage of the cell rather than as a fixed pixel is what
 * keeps the board looking like a go board at 360px and at 620px. The 16% of
 * clearance is what lets the grid line under the stone stay visible.
 */
const STONE_INSET = "p-[8%]";

function Stone({ color, marked }: { color: "black" | "white"; marked: boolean }): React.ReactElement {
  return (
    <span className="relative block w-full" style={{ aspectRatio: "1 / 1" }}>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full",
          color === "black"
            ? // Jet black with a single specular highlight in the upper left, so
              // the stone reads as a solid sphere rather than a flat circle.
              "bg-[radial-gradient(circle_at_32%_26%,#52525b_0%,#18181b_42%,#000000_100%)] shadow-[0_2px_5px_rgba(0,0,0,0.6)]"
            : // Pearl white: a bright face, a light rim to separate it from the
              // wood, and a soft shadow to seat it on the line.
              "bg-white border border-neutral-300 shadow-[0_2px_5px_rgba(0,0,0,0.35)]"
        )}
      />
      {/* The last move is marked the way it is on a real board: a small pip in
          the opposite colour, so it is legible on a black stone and a white one
          alike without drawing a ring around either. */}
      {marked ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-1/2 top-1/2 block size-[24%] -translate-x-1/2 -translate-y-1/2 rounded-full",
            color === "black" ? "bg-neutral-300" : "bg-neutral-900"
          )}
        />
      ) : null}
    </span>
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
      className={cn(
        "grid w-full gap-0 overflow-hidden rounded-md border-2 border-[#4A3718] p-0 shadow-md",
        WOOD
      )}
      style={{
        gridTemplateColumns: `repeat(${GOMOKU_SIZE}, minmax(0, 1fr))`,
        // Two 1px lines per axis, tiled every cell and offset by half a cell so
        // each line lands on an intersection rather than on a cell boundary.
        // The outer half-cell on the right and bottom is closed by the frame.
        backgroundImage: `linear-gradient(to right, ${LINE} 1px, transparent 1px), linear-gradient(to bottom, ${LINE} 1px, transparent 1px)`,
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
          const isHoshi = HOSHI.has(key);
          // The ghost previews the single intersection the pointer is on, and
          // only while the pointer is genuinely there. A ghost on every legal
          // square would put ~225 of them on the board at once.
          const showGhost = !disabled && cell === null && target && hovered?.x === x && hovered?.y === y;

          return (
            <BoardTile
              key={key}
              label={`${formatGridSquare(x, y, GOMOKU_SIZE)}${cell ? `, ${cell} stone` : ", empty"}`}
              size={size}
              shape="circle"
              disabled={disabled}
              // Deliberately not `isLegalTarget`: on this board every empty
              // square is legal, and a per-square marker is the clutter this
              // view exists to avoid.
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
                "bg-transparent",
                STONE_INSET,
                "hover:bg-black/5",
                "disabled:hover:bg-transparent",
                selected && "bg-black/10"
              )}
            >
              {cell !== null ? (
                <Stone color={cell} marked={latest} />
              ) : showGhost ? (
                <span
                  aria-hidden="true"
                  className="block w-full animate-pulse rounded-full border-2 border-dashed border-[#4A3718] bg-black/10"
                  style={{ aspectRatio: "1 / 1" }}
                />
              ) : isHoshi ? (
                <span
                  aria-hidden="true"
                  className="block size-[18%] rounded-full bg-[#4A3718]"
                />
              ) : null}
            </BoardTile>
          );
        })
      )}
    </div>
  );
}
