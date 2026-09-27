"use client";

/**
 * Section 3.5 — Reversi.
 *
 * Legal placements are shown as a hollow dot rather than a tinted square: the
 * dot matches the disc it will become, so the board previews the result of the
 * move instead of just marking the square. A filled disc on a legal square is
 * never possible, so the two states cannot be confused.
 */

import { useMemo } from "react";

import { assertBoardSnapshot, Coordinates } from "@/engine/types";
import { REVERSI_SIZE } from "@/engine/rules/reversi";
import { cn } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole, targetRing } from "./boardViewTypes";

const DISC_RATIO = 0.76;

function Disc({ color }: { color: "black" | "white" }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block rounded-full border shadow-[inset_0_-1px_2px_rgba(0,0,0,0.22)]",
        color === "black" ? "border-board-dark bg-board-dark" : "border-board-light bg-board-light"
      )}
      style={{ width: `${DISC_RATIO * 100}%`, aspectRatio: "1 / 1" }}
    />
  );
}

export function ReversiBoardView({
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
  const state = useMemo(() => assertBoardSnapshot(board, "reversi").state, [board]);

  const roles = useMemo(() => {
    const map = new Map<string, SquareRole>();
    for (let y = 0; y < REVERSI_SIZE; y += 1) {
      for (let x = 0; x < REVERSI_SIZE; x += 1) {
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
      aria-rowcount={REVERSI_SIZE}
      aria-colcount={REVERSI_SIZE}
      aria-disabled={disabled || undefined}
      className="inline-grid shrink-0 gap-px rounded-sm border border-hairline bg-hairline p-px"
      style={{
        gridTemplateColumns: `repeat(${REVERSI_SIZE}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${REVERSI_SIZE}, minmax(0, 1fr))`,
      }}
    >
      {state.map((row, y) =>
        row.map((cell, x) => {
          const coord: Coordinates = { x, y };
          const role = roles.get(coordKey(coord)) ?? "plain";
          const target = role === "target";

          return (
            <BoardTile
              key={coordKey(coord)}
              label={`Column ${x + 1}, row ${y + 1}${cell ? `, ${cell} disc` : ", empty"}`}
              size={size}
              shape="circle"
              disabled={disabled}
              selected={role === "selected"}
              isLegalTarget={target}
              isLastMove={isLastMove(lastMove, coord)}
              onClick={() => onSquareActivate(coord)}
              className={cn(
                "aspect-square border-0 bg-board-dark/5",
                lastMoveWash(role),
                targetRing(role)
              )}
            >
              {cell !== null ? (
                <Disc color={cell} />
              ) : target && !disabled ? (
                <span
                  aria-hidden="true"
                  className="block rounded-full border-2 border-board-muted/60"
                  style={{ width: `${DISC_RATIO * 100}%`, aspectRatio: "1 / 1" }}
                />
              ) : null}
            </BoardTile>
          );
        })
      )}
    </div>
  );
}
