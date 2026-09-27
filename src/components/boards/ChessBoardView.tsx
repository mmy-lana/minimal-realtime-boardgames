"use client";

/**
 * Section 3.6 — Chess.
 *
 * A two-tone cell grid with algebraic labels, the one board here where the
 * orientation is worth fighting for: the engine indexes `board[y][x]` with
 * rank 7 at row 0, so the view flips the y axis to put the player's own pieces
 * along the bottom. Black plays from the top of the screen in that flipped
 * view, which is the orientation a player at the black side expects.
 *
 * Pieces are glyphs rather than images, so the board carries no asset weight
 * and renders identically offline. The glyph size follows the cell rather than
 * a fixed pixel step, which is what keeps a queen legible on a 360px phone and
 * from turning into a blur on a desktop.
 */

import { useMemo } from "react";

import { assertBoardSnapshot, ChessPiece, Coordinates } from "@/engine/types";
import { CHESS_SIZE } from "@/engine/rules/chess";
import { cn, formatSquare } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole } from "./boardViewTypes";

/** Unicode chess glyphs. The white set is the filled one, so the two sides
 *  differ by weight as well as by colour. */
const GLYPHS: Record<ChessPiece["type"], { black: string; white: string }> = {
  k: { black: "♚", white: "♔" },
  q: { black: "♛", white: "♕" },
  r: { black: "♜", white: "♖" },
  b: { black: "♝", white: "♗" },
  n: { black: "♞", white: "♘" },
  p: { black: "♟", white: "♙" },
};

const PIECE_NAMES: Record<ChessPiece["type"], string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

function Piece({ piece }: { piece: ChessPiece }): React.ReactElement {
  const isWhite = piece.color === "white";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block w-full select-none text-center leading-none",
        isWhite
          ? // White glyphs are the outline set, so they need a dark square
            // behind them to read at all.
            "text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"
          : "text-neutral-950 drop-shadow-[0_1px_1px_rgba(255,255,255,0.55)]"
      )}
      style={{ fontSize: "min(9cqw, 2.6rem)" }}
    >
      {GLYPHS[piece.type][piece.color]}
    </span>
  );
}

export function ChessBoardView({
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
  const state = useMemo(() => assertBoardSnapshot(board, "chess").state, [board]);

  // Files read a–h left to right; ranks read 8→1 top to bottom.
  const files = Array.from({ length: CHESS_SIZE }, (_, i) => i);
  const ranks = Array.from({ length: CHESS_SIZE }, (_, i) => CHESS_SIZE - 1 - i);

  const roles = useMemo(() => {
    const map = new Map<string, SquareRole>();
    for (let y = 0; y < CHESS_SIZE; y += 1) {
      for (let x = 0; x < CHESS_SIZE; x += 1) {
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
    <div className="flex w-full flex-col gap-1">
      <div className="flex gap-1">
        <div
          aria-hidden="true"
          // Explicit rows so the rank labels line up with the board's eight
          // square rows rather than drifting with the text's own line height.
          className="grid w-4 shrink-0"
          style={{ gridTemplateRows: `repeat(${CHESS_SIZE}, minmax(0, 1fr))` }}
        >
          {ranks.map((y) => (
            <span
              key={`rank-${y}`}
              className="flex items-center justify-center text-[10px] font-medium tabular-nums text-board-muted"
            >
              {y + 1}
            </span>
          ))}
        </div>

        <div
          role="grid"
          aria-label={label}
          aria-rowcount={CHESS_SIZE}
          aria-colcount={CHESS_SIZE}
          aria-disabled={disabled || undefined}
          className="grid w-full grid-cols-8 overflow-hidden rounded-md border-2 border-neutral-800 shadow-md"
          style={{
            gridTemplateColumns: `repeat(${CHESS_SIZE}, minmax(0, 1fr))`,
            // `container-type: inline-size` is what lets the glyphs size from
            // the board's own width: `9cqw` is 9% of the board, so a piece is
            // always the same fraction of its square on every viewport.
            containerType: "inline-size",
          }}
        >
          {ranks.map((y) =>
            files.map((x) => {
              const coord: Coordinates = { x, y };
              const key = coordKey(coord);
              const role = roles.get(key) ?? "plain";
              const cell = state[y]?.[x] ?? null;
              // The light square of each pair, so the checkerboard is stable
              // across the flipped ranks.
              const isLight = (x + y) % 2 === 1;
              const latest = isLastMove(lastMove, coord);

              return (
                <BoardTile
                  key={key}
                  label={`${formatSquare(coord.x, coord.y)}${
                    cell ? `, ${cell.color} ${PIECE_NAMES[cell.type]}` : ", empty"
                  }`}
                  size={size}
                  disabled={disabled}
                  selected={role === "selected"}
                  isLegalTarget={role === "target"}
                  isLastMove={latest}
                  onClick={() => onSquareActivate(coord)}
                  className={cn(
                    "rounded-none border-0",
                    isLight
                      ? "bg-amber-100 hover:bg-amber-200 disabled:hover:bg-amber-100"
                      : "bg-amber-800 hover:bg-amber-700 disabled:hover:bg-amber-800",
                    lastMoveWash(role),
                    latest && "after:pointer-events-none after:absolute after:inset-0 after:bg-amber-400/25",
                    role === "selected" && "after:pointer-events-none after:absolute after:inset-0 after:bg-emerald-500/35",
                    role === "target" &&
                      "after:pointer-events-none after:absolute after:inset-[22%] after:rounded-full after:bg-emerald-600/60"
                  )}
                >
                  {cell ? <Piece piece={cell} /> : null}
                </BoardTile>
              );
            })
          )}
        </div>
      </div>

      <div aria-hidden="true" className="ml-[21px] grid grid-cols-8">
        {files.map((x) => (
          <span
            key={`file-${x}`}
            className="text-center text-[10px] font-medium tracking-wide text-board-muted"
          >
            {String.fromCharCode(97 + x)}
          </span>
        ))}
      </div>
    </div>
  );
}
