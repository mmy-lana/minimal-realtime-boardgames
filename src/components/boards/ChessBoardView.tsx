"use client";

/**
 * Section 3.6 — Chess.
 *
 * A two-tone cell grid with algebraic labels, the one board here where the
 * orientation is worth fighting for: the engine indexes `board[y][x]` with
 * rank 7 at row 0, so the view flips the y axis to put the player's own
 * pieces along the bottom. Black plays from the top of the screen in that
 * flipped view, which is the orientation a player at the black side expects.
 *
 * Pieces are glyphs rather than images, so the board carries no asset weight
 * and renders identically offline.
 */

import { useMemo } from "react";

import { assertBoardSnapshot, ChessPiece, Coordinates, PlayerColor } from "@/engine/types";
import { CHESS_SIZE } from "@/engine/rules/chess";
import { cn, formatSquare } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole, targetRing } from "./boardViewTypes";

const PIECE_RATIO = 0.7;

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

const FONT_SIZE: Record<"sm" | "md" | "lg", number> = { sm: 18, md: 26, lg: 38 };

function Piece({ piece, size }: { piece: ChessPiece; size: "sm" | "md" | "lg" }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block select-none leading-none",
        piece.color === "black" ? "text-board-dark" : "text-board-light"
      )}
      style={{
        width: `${PIECE_RATIO * 100}%`,
        fontSize: `${FONT_SIZE[size]}px`,
        // A dark glyph on a dark cell is unreadable, so the white side always
        // gets a dark cell behind it regardless of the two-tone rotation.
        filter: piece.color === "white" ? "drop-shadow(0 1px 1px rgba(0,0,0,0.5))" : "drop-shadow(0 1px 0 rgba(255,255,255,0.35))",
      }}
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
    <div className="inline-flex shrink-0 flex-col gap-1">
      <div
        role="grid"
        aria-label={label}
        aria-rowcount={CHESS_SIZE}
        aria-colcount={CHESS_SIZE}
        aria-disabled={disabled || undefined}
        className="inline-grid overflow-hidden rounded-sm border border-board-muted"
        style={{
          gridTemplateColumns: `repeat(${CHESS_SIZE}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${CHESS_SIZE}, minmax(0, 1fr))`,
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
                isLastMove={isLastMove(lastMove, coord)}
                onClick={() => onSquareActivate(coord)}
                className={cn(
                  "aspect-square border-0 border-r border-b border-r-0 border-b-0",
                  isLight ? "bg-board-light" : "bg-board-dark",
                  lastMoveWash(role),
                  targetRing(role)
                )}
              >
                {cell ? <Piece piece={cell} size={size} /> : role === "target" && !disabled ? (
                  <span
                    aria-hidden="true"
                    className="block rounded-full bg-board-dark/25"
                    style={{ width: `${PIECE_RATIO * 100}%`, aspectRatio: "1 / 1" }}
                  />
                ) : null}
              </BoardTile>
            );
          })
        )}
      </div>

      <div
        aria-hidden="true"
        className="grid pl-5"
        style={{ gridTemplateColumns: `repeat(${CHESS_SIZE}, minmax(0, 1fr))` }}
      >
        {files.map((x) => (
          <span
            key={`file-${x}`}
            className="text-center text-[10px] font-medium tracking-wide text-board-muted"
          >
            {String.fromCharCode(97 + x)}
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <div
          aria-hidden="true"
          className="grid w-5"
          style={{ gridTemplateRows: `repeat(${CHESS_SIZE}, minmax(0, 1fr))` }}
        >
          {ranks.map((y) => (
            <span
              key={`rank-${y}`}
              className="flex items-center justify-center text-[10px] font-medium tracking-wide text-board-muted"
            >
              {y + 1}
            </span>
          ))}
        </div>
        <div className="flex-1" />
      </div>
    </div>
  );
}

/** Re-exported so the shell can label the two seats without a second import. */
export type ChessSide = PlayerColor;
