"use client";

/**
 * Section 3.6 — Checkers.
 *
 * A two-tone cell grid, not an intersection board. Only the dark squares are
 * playable, and the off-play squares are rendered as recessed wells rather than
 * being left blank, so the board reads as a checkerboard at a glance and the
 * piece count is legible at a glance.
 *
 * **Kings are marked by a crown, not by a ring.** A king used to be a disc with
 * a dashed inner ring and a man a disc with a solid pip — the same shape at two
 * opacities, which is a distinction that disappears under a glare, a projector,
 * or a tired eye at the end of a long game. A crown is a different shape, and
 * draughts players have read them at a glance for two centuries. The pip stays,
 * so the man keeps its centre of visual weight.
 *
 * Selection is an inset ring, not a fill. Changing a tile's background is fine
 * (it is a paint operation, not a layout one), but the earlier treatment also
 * swapped the square for a solid emerald block, which erased the checkerboard
 * under the piece and made it briefly unclear where the piece had been.
 */

import { useMemo } from "react";

import { assertBoardSnapshot, CheckersPiece, Coordinates } from "@/engine/types";
import { CHECKERS_SIZE, isPlayableSquare } from "@/engine/rules/checkers";
import { cn, formatGridSquare } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole } from "./boardViewTypes";

/** Disc diameter as a fraction of its square. The remainder is the well. */
const PIECE_RATIO = 0.82;

function Checker({ piece }: { piece: CheckersPiece }): React.ReactElement {
  const isKing = piece.type === "king";
  const isBlack = piece.color === "black";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex w-full items-center justify-center rounded-full border-2 shadow-md",
        isBlack
          ? "border-neutral-600 bg-neutral-900"
          : "border-amber-300 bg-amber-50"
      )}
      style={{ aspectRatio: "1 / 1" }}
    >
      {isKing ? (
        // White pieces are cream on a dark square, so the crown is ink; black
        // pieces are near-black on a dark square, so theirs is gold. Both stay
        // legible against the disc they sit on.
        <span
          className={cn(
            "flex w-[68%] items-center justify-center rounded-full border-2 text-[min(3.2cqw,0.9rem)] leading-none",
            isBlack
              ? "border-amber-400/70 text-amber-300"
              : "border-amber-500/60 text-amber-700"
          )}
        >
          ♔
        </span>
      ) : (
        <span
          className={cn(
            "block size-[30%] rounded-full",
            isBlack ? "bg-neutral-600" : "bg-amber-300"
          )}
        />
      )}
    </span>
  );
}

export function CheckersBoardView({
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
  const state = useMemo(() => assertBoardSnapshot(board, "checkers").state, [board]);

  const roles = useMemo(() => {
    const map = new Map<string, SquareRole>();
    for (let y = 0; y < CHECKERS_SIZE; y += 1) {
      for (let x = 0; x < CHECKERS_SIZE; x += 1) {
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
      aria-rowcount={CHECKERS_SIZE}
      aria-colcount={CHECKERS_SIZE}
      aria-disabled={disabled || undefined}
      className="grid w-full max-w-[min(92vw,560px)] gap-0.5 rounded-lg border-2 border-neutral-800 p-0.5"
      style={{
        aspectRatio: "1 / 1",
        gridTemplateColumns: `repeat(${CHECKERS_SIZE}, minmax(0, 1fr))`,
        // The playable squares are dark slate and the off-play squares are
        // light slate, so the checkerboard survives even before a piece lands
        // on it. The two used to be the same near-white as the page.
        backgroundColor: "var(--color-neutral-800)",
        // Contained units so the crown glyph can size itself against the board
        // rather than against the viewport.
        containerType: "inline-size",
      }}
    >
      {state.map((row, y) =>
        row.map((cell, x) => {
          const coord: Coordinates = { x, y };
          const key = coordKey(coord);
          const playable = isPlayableSquare(x, y);
          const role = roles.get(key) ?? "plain";
          const target = role === "target";

          return (
            <BoardTile
              key={key}
              label={`Square ${formatGridSquare(x, y, CHECKERS_SIZE)}${
                cell ? `, ${cell.color} ${cell.type}` : playable ? ", empty" : ", not in play"
              }`}
              size={size}
              shape="circle"
              disabled={disabled || !playable}
              selected={role === "selected"}
              isLegalTarget={target}
              isLastMove={isLastMove(lastMove, coord)}
              onClick={() => onSquareActivate(coord)}
              className={cn(
                "rounded-sm p-[9%]",
                playable
                  ? "bg-neutral-800 hover:bg-neutral-700 disabled:hover:bg-neutral-800"
                  : "bg-neutral-200",
                "disabled:cursor-not-allowed",
                lastMoveWash(role),
                // Selection is an inset ring: it paints inside the square, so it
                // cannot take a pixel from its neighbour, and it leaves the
                // checkerboard visible under the lifted piece.
                role === "selected" && "ring-4 ring-inset ring-amber-400",
                role === "selectable" && !disabled && "hover:bg-neutral-600"
                // No `after:` marker and no last-move ring here: BoardTile owns
                // both, and a view painting its own leaves two competing sets
                // of utilities on one element.
              )}
            >
              {cell ? (
                <Checker piece={cell} />
              ) : target && !disabled && playable ? (
                <span
                  aria-hidden="true"
                  className="block w-full animate-pulse rounded-full border-2 border-dashed border-amber-300"
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
