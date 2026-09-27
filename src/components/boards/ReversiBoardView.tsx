"use client";

/**
 * Section 3.5 — Reversi.
 *
 * Legal placements are shown as a hollow dot rather than a tinted square: the
 * dot matches the disc it will become, so the board previews the result of the
 * move instead of just marking the square. A filled disc on a legal square is
 * never possible, so the two states cannot be confused.
 *
 * The felt is dark green and the discs carry a light rim each, so black reads
 * against the felt and white reads against its own shadow — the monochrome
 * palette this board used to share with the rest of the product put both
 * colours on a background of their own.
 */

import { useMemo } from "react";

import { assertBoardSnapshot, Coordinates } from "@/engine/types";
import { REVERSI_SIZE } from "@/engine/rules/reversi";
import { cn } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole } from "./boardViewTypes";

function Disc({ color }: { color: "black" | "white" }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block w-full rounded-full border-2 shadow-md",
        color === "black"
          ? "border-neutral-600 bg-neutral-950"
          : "border-neutral-300 bg-neutral-50"
      )}
      style={{ aspectRatio: "1 / 1" }}
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
      className="grid w-full gap-1 rounded-lg border-2 border-emerald-950 bg-emerald-900 p-1.5 shadow-md sm:gap-1.5 sm:p-2"
      style={{
        gridTemplateColumns: `repeat(${REVERSI_SIZE}, minmax(0, 1fr))`,
      }}
    >
      {state.map((row, y) =>
        row.map((cell, x) => {
          const coord: Coordinates = { x, y };
          const key = coordKey(coord);
          const role = roles.get(key) ?? "plain";
          const target = role === "target";

          return (
            <BoardTile
              key={key}
              label={`Column ${x + 1}, row ${y + 1}${cell ? `, ${cell} disc` : ", empty"}`}
              size={size}
              shape="circle"
              disabled={disabled}
              selected={role === "selected"}
              isLegalTarget={target}
              isLastMove={isLastMove(lastMove, coord)}
              onClick={() => onSquareActivate(coord)}
              className={cn(
                "rounded-full border-0",
                "bg-emerald-800",
                "hover:bg-emerald-700",
                "disabled:hover:bg-emerald-800",
                lastMoveWash(role),
                selected && "bg-emerald-600",
                isLastMove(lastMove, coord) && "ring-2 ring-amber-400",
                target && "bg-emerald-600"
              )}
            >
              {cell !== null ? (
                <Disc color={cell} />
              ) : target && !disabled ? (
                <span
                  aria-hidden="true"
                  className="block w-[34%] animate-pulse rounded-full border-2 border-dashed border-emerald-200"
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
