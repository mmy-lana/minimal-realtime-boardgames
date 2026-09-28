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
 *
 * **The labels are placed by a grid, not by an offset.** The file row used to
 * be pulled into line with the board with `ml-[21px]` — 16px of rank gutter,
 * 4px of gap and 1px of half-border, written down as a single magic number.
 * That number is wrong the moment any of those three change, and when it was
 * wrong the `a` sat half a pixel left of the a-file with nothing to say so.
 * Here the whole board, both gutters and the corner are cells of one
 * two-column grid: the file labels and the squares share a track, and the rank
 * labels stretch to the board's own height and split it into eight equal rows.
 * Alignment is a consequence of the layout rather than a number someone
 * remembered to update.
 *
 * The squares are the tournament wood `#F0D9B5` and `#B58863`. Both are close
 * enough in lightness that the previous `amber-100`/`amber-800` pairing was
 * really about hue, and the pairing read as a yellow board rather than a chess
 * one; the wood is a warmer, less saturated pair that keeps the pieces the
 * most contrasty thing on the board.
 */

import { useMemo } from "react";

import { assertBoardSnapshot, ChessPiece, Coordinates } from "@/engine/types";
import { CHESS_SIZE } from "@/engine/rules/chess";
import { cn, formatSquare } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, SquareRole, squareRole } from "./boardViewTypes";

/** Tournament wood. */
const LIGHT_SQUARE = "bg-[#F0D9B5]";
const DARK_SQUARE = "bg-[#B58863]";

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
          ? // The white set is outlined glyphs, so it needs the drop shadow to
            // hold an edge against the light square it usually lands on.
            "text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
          : // The black set is solid, so a *light* shadow separates it from the
            // dark square rather than adding weight to something already heavy.
            "text-neutral-950 drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)]"
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
    // Two columns — an auto-sized label track and the board — and two rows: the
    // file labels above, the board and its rank gutter below. Both label sets
    // share a track with the board, so neither can drift out of alignment.
    <div
      className="grid w-full max-w-[min(92vw,580px)] gap-1.5"
      style={{ gridTemplateColumns: "auto minmax(0, 1fr)" }}
    >
      <span aria-hidden="true" />

      <div
        aria-hidden="true"
        className="grid"
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

      <div
        aria-hidden="true"
        // Eight explicit rows against the board's own height, so each digit
        // centres on one square instead of drifting with its line height.
        className="grid w-4"
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
        // Square, and capped: chess is 64 squares and grows past that by
        // getting airier, not larger.
        className="grid w-full overflow-hidden rounded-md border-2 border-neutral-800 shadow-md"
        style={{
          aspectRatio: "1 / 1",
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

            return (
              <BoardTile
                key={key}
                label={`${formatSquare(coord.x, coord.y)}${
                  cell ? `, ${cell.color} ${PIECE_NAMES[cell.type]}` : ", empty"
                }`}
                size={size}
                disabled={disabled}
                selected={role === "selected"}
                // A gold glow rather than a fill: the selected square stays the
                // same size, and the piece on it stays fully readable.
                selectedRingClass="ring-2 ring-inset ring-amber-300"
                isLegalTarget={role === "target" && !disabled}
                // A centred green dot, the convention for a legal destination
                // in every chess interface ever written.
                targetDotClass="after:bg-emerald-600/80"
                isLastMove={isLastMove(lastMove, coord)}
                onClick={() => onSquareActivate(coord)}
                className={cn(
                  "rounded-none",
                  isLight ? LIGHT_SQUARE : DARK_SQUARE,
                  // One hover treatment for both squares: a filter adjusts the
                  // wood that is already there, instead of a second hard-coded
                  // colour that would have to be kept in step with the first.
                  "hover:brightness-[0.92] disabled:hover:brightness-100",
                  role === "selected" && "brightness-110",
                  lastMoveWash(role)
                )}
              >
                {cell ? <Piece piece={cell} /> : null}
              </BoardTile>
            );
          })
        )}
      </div>
    </div>
  );
}
