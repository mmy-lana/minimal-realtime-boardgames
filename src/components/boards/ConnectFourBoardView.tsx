"use client";

/**
 * Section 3.3 — Connect Four.
 *
 * The board is built from columns rather than cells, because that is the only
 * shape that makes the drop target honest: a single button spans all seven
 * rows of a column and the engine reports where the disc will actually land.
 * Hovering a column previews the landing square, and the whole column is one
 * tab stop with a per-row description for screen readers.
 */

import { useMemo, useState } from "react";

import { assertBoardSnapshot, Coordinates, PlayerColor } from "@/engine/types";
import {
  CONNECT4_COLS,
  CONNECT4_ROWS,
  getConnect4LowestAvailableRow,
} from "@/engine/rules/connect4";
import { cn } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import { BoardViewProps, coordKey, isLastMove, lastMoveWash, targetRing } from "./boardViewTypes";

const DISC_RATIO = 0.78;

function Disc({ color }: { color: PlayerColor }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block rounded-full border",
        color === "black"
          ? "border-board-dark bg-board-dark"
          : "border-board-light bg-board-light"
      )}
      style={{ width: `${DISC_RATIO * 100}%`, aspectRatio: "1 / 1" }}
    />
  );
}

export function ConnectFourBoardView({
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
  const state = useMemo(() => assertBoardSnapshot(board, "connect4").state, [board]);
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null);

  // The column the user is currently pointing at, whether from a pointer or
  // from keyboard focus, previews the disc's destination.
  const previewColumn = hoveredColumn;
  const landingRow = useMemo(() => {
    if (previewColumn === null) return null;
    return getConnect4LowestAvailableRow(state, previewColumn);
  }, [previewColumn, state]);

  const isColumnTarget = (x: number): boolean => {
    const row = getConnect4LowestAvailableRow(state, x);
    if (row < 0) return false;
    const key = `${x},${row}`;
    return legalSquares.has(key) || destinations.has(key);
  };

  return (
    <div
      role="grid"
      aria-label={label}
      aria-colcount={CONNECT4_COLS}
      aria-rowcount={CONNECT4_ROWS}
      aria-disabled={disabled || undefined}
      className="inline-grid shrink-0 gap-1 rounded-md border border-hairline bg-hairline p-1"
      style={{ gridTemplateColumns: `repeat(${CONNECT4_COLS}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: CONNECT4_COLS }, (_, x) => {
        const row = getConnect4LowestAvailableRow(state, x);
        const playable = !disabled && row >= 0 && isColumnTarget(x);
        const showsPreview = landingRow !== null && landingRow >= 0 && previewColumn === x;

        return (
          <div
            key={`column-${x}`}
            role="row"
            className="grid gap-1"
            style={{ gridTemplateRows: `repeat(${CONNECT4_ROWS}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: CONNECT4_ROWS }, (_, y) => {
              const coord: Coordinates = { x, y };
              const cell = state[y]?.[x] ?? null;
              const role =
                destinations.has(coordKey(coord)) || legalSquares.has(coordKey(coord))
                  ? "target"
                  : "plain";
              const isEmpty = cell === null;
              const isPreview = showsPreview && y === landingRow;

              return (
                <BoardTile
                  key={coordKey(coord)}
                  label={`Column ${x + 1}, row ${y + 1}${cell ? `, ${cell} disc` : ", empty"}`}
                  size={size}
                  shape="circle"
                  disabled={disabled}
                  isLegalTarget={role === "target"}
                  isLastMove={isLastMove(lastMove, coord)}
                  tabIndex={x === 0 && y === 0 ? 0 : -1}
                  onClick={() => {
                    if (playable) onSquareActivate(coord);
                  }}
                  onMouseEnter={() => setHoveredColumn(x)}
                  onMouseLeave={() => setHoveredColumn((current) => (current === x ? null : current))}
                  onFocus={() => setHoveredColumn(x)}
                  onBlur={() => setHoveredColumn((current) => (current === x ? null : current))}
                  className={cn(
                    "aspect-square border-0 bg-board-dark/5",
                    lastMoveWash(isLastMove(lastMove, coord) ? "last-move" : "plain"),
                    // The column, not the cell, is the hit area on touch, so the
                    // per-cell ring is replaced by a ghost disc on the landing
                    // square and a column tint on the button.
                    targetRing(role),
                    isPreview && "bg-board-muted/25"
                  )}
                >
                  {cell !== null ? (
                    <Disc color={cell} />
                  ) : isPreview && playable ? (
                    <span
                      aria-hidden="true"
                      className="block rounded-full border-2 border-dashed border-board-muted/70"
                      style={{ width: `${DISC_RATIO * 100}%`, aspectRatio: "1 / 1" }}
                    />
                  ) : null}
                </BoardTile>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
