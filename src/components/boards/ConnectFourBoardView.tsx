"use client";

/**
 * Section 3.3 — Connect Four.
 *
 * The board is built from columns rather than cells, because that is the only
 * shape that makes the drop target honest: one control spans all six slots of
 * a column and the engine reports where the disc will actually land. Hovering
 * a column previews the landing slot, and the whole column is one tab stop with
 * its own label for screen readers.
 *
 * Colour here is a contrast decision, not decoration. The board is a dark slate
 * well with near-black sockets, so a black disc (dark) has to carry a light rim
 * and a white disc (light) a dark one — the two used to be `board-dark` disc on
 * `board-light` cell, which put each disc on a background of its own colour and
 * made both of them disappear.
 */

import { useMemo, useState } from "react";

import { assertBoardSnapshot, Coordinates, PlayerColor } from "@/engine/types";
import {
  CONNECT4_COLS,
  CONNECT4_ROWS,
  getConnect4LowestAvailableRow,
} from "@/engine/rules/connect4";
import { cn } from "@/lib/utils";
import { coordKey, isLastMove, type BoardViewProps } from "./boardViewTypes";

function Disc({ color }: { color: PlayerColor }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block w-full rounded-full border-2 shadow-inner",
        color === "black"
          ? "border-neutral-500 bg-neutral-900 shadow-neutral-950"
          : "border-neutral-400 bg-neutral-100 shadow-neutral-300"
      )}
      style={{ aspectRatio: "1 / 1" }}
    />
  );
}

export function ConnectFourBoardView({
  board,
  legalSquares,
  destinations,
  lastMove,
  disabled,
  onSquareActivate,
  label,
}: BoardViewProps): React.ReactElement {
  const state = useMemo(() => assertBoardSnapshot(board, "connect4").state, [board]);
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);

  // The column the player is currently pointing at, from a pointer or from
  // keyboard focus, previews the disc's destination.
  const landingRow = useMemo(
    () => (hoveredColumn === null ? null : getConnect4LowestAvailableRow(state, hoveredColumn)),
    [hoveredColumn, state],
  );

  return (
    <div
      role="grid"
      aria-label={label}
      aria-colcount={CONNECT4_COLS}
      aria-rowcount={CONNECT4_ROWS}
      aria-disabled={disabled || undefined}
      className="grid w-full gap-1.5 rounded-lg border-2 border-neutral-800 bg-neutral-800 p-1.5 sm:gap-2 sm:p-2"
      style={{ gridTemplateColumns: `repeat(${CONNECT4_COLS}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: CONNECT4_COLS }, (_, x) => {
        const row = getConnect4LowestAvailableRow(state, x);
        const landingKey = row >= 0 ? `${x},${row}` : null;
        // A column is a drop target only when the engine lists its landing
        // slot; a full column is not a control the player can act on.
        const playable =
          !disabled &&
          landingKey !== null &&
          (legalSquares.has(landingKey) || destinations.has(landingKey));

        return (
          <div
            key={`column-${x}`}
            role="row"
            className="relative grid gap-1 sm:gap-1.5"
            style={{ gridTemplateRows: `repeat(${CONNECT4_ROWS}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: CONNECT4_ROWS }, (_, y) => {
              const coord: Coordinates = { x, y };
              const cell = state[y]?.[x] ?? null;
              const isPreview = playable && landingRow === y;

              return (
                <div
                  key={coordKey(coord)}
                  className={cn(
                    "flex aspect-square w-full items-center justify-center rounded-full",
                    "bg-neutral-950 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]",
                    // The last-move wash is a ring on the socket, because the
                    // socket is the only element with room for one.
                    isLastMove(lastMove, coord) && "ring-2 ring-amber-400/80"
                  )}
                >
                  {cell !== null ? (
                    <Disc color={cell} />
                  ) : isPreview ? (
                    <span
                      aria-hidden="true"
                      className="block w-full animate-pulse rounded-full border-2 border-dashed border-neutral-500"
                      style={{ aspectRatio: "1 / 1" }}
                    />
                  ) : null}
                </div>
              );
            })}

            {/* One control per column, stretched over all six slots. This is
                the hit area the game actually has: you aim at a column, not
                at one of its rows, and on touch the whole column is the target
                rather than a 22px cell. */}
            <button
              type="button"
              className={cn(
                "absolute inset-0 z-10 rounded-lg",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                playable && !disabled && "cursor-pointer hover:bg-white/5"
              )}
              aria-label={
                playable
                  ? `Column ${x + 1}, drop a disc in row ${CONNECT4_ROWS - row} from the top`
                  : `Column ${x + 1}, full`
              }
              disabled={!playable}
              data-board-surface=""
              onClick={() => {
                if (playable) onSquareActivate({ x, y: row });
              }}
              onMouseEnter={() => setHoveredColumn(x)}
              onMouseLeave={() => setHoveredColumn((current) => (current === x ? null : current))}
              onFocus={() => setHoveredColumn(x)}
              onBlur={() => setHoveredColumn((current) => (current === x ? null : current))}
            />
          </div>
        );
      })}
    </div>
  );
}
