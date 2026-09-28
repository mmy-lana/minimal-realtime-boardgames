"use client";

/**
 * Section 3.3 — Connect Four.
 *
 * The board is built from columns rather than cells, because that is the only
 * shape that makes the drop target honest: one control spans all six slots of a
 * column and the engine reports where the disc will actually land. Hovering a
 * column previews the landing slot, and the whole column is one tab stop with
 * its own label for screen readers.
 *
 * **Why the playfield has its own `aspect-[7/6]` and the frame does not.**
 * Connect Four is 7 wide and 6 tall, and the board was supposed to be 7:6. It
 * wasn't, and it wasn't close. The frame carried the padding, the border and
 * the `aspect-square` all at once, so the 7 columns and 6 rows were laid out
 * in a box that had already lost 20px of width and height to chrome — and a
 * box of `(W-20) x (W*6/7 - 20)` is not 7:6 at any width. Every cell then had
 * `aspect-square` forcing it back to a square, so the rows silently overflowed
 * the frame they were supposed to fill.
 *
 * The fix is to put the ratio on a box with no chrome of its own. The frame
 * (padding, border, shadow) is an outer wrapper; the playfield inside it is
 * exactly 7:6 with no gap. That makes every cell exactly square — the columns
 * are `W/7` and the rows are `(W*6/7)/6`, which is the same number — and the
 * separation between sockets comes from per-cell padding instead of a gap that
 * would have made the cells non-square. The board is now 7:6 to the pixel, and
 * the discs are round.
 *
 * Colour is a contrast decision, and it follows the player names. The score
 * cards and the result dialog call the players Black and White, so the discs
 * are black and white too: a jet-black disc with a bright rim, and a white disc
 * with a dark one. Painting them red and amber would have been a livelier
 * board and a worse product — a red disc labelled "Black" in the move list is
 * the kind of detail that makes players stop trusting the interface.
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

/** Clearance between neighbouring sockets, as a share of the cell. */
const SOCKET_INSET = "p-[6%]";

function Disc({ color }: { color: PlayerColor }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="relative block w-full"
      style={{ aspectRatio: "1 / 1" }}
    >
      <span
        className={cn(
          "absolute inset-0 rounded-full border-2",
          color === "black"
            ? // Jet black, kept legible on a near-black socket by a bright rim
              // and a single specular highlight — without the rim the disc and
              // the hole it sits in are the same shape in the same shade.
            "border-neutral-400 bg-[radial-gradient(circle_at_34%_28%,#52525b_0%,#18181b_46%,#000000_100%)] shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
            : // Pearl white with a dark rim, so it separates from the frame
              // it is held in and from a white disc in the next column.
              "border-neutral-700 bg-[radial-gradient(circle_at_34%_28%,#ffffff_0%,#f4f4f5_55%,#d4d4d8_100%)] shadow-[0_2px_4px_rgba(0,0,0,0.45)]"
        )}
      />
    </span>
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
    [hoveredColumn, state]
  );

  return (
    <div
      role="grid"
      aria-label={label}
      aria-colcount={CONNECT4_COLS}
      aria-rowcount={CONNECT4_ROWS}
      aria-disabled={disabled || undefined}
      className={cn(
        // The frame. Matte navy, so the black discs and the white ones both
        // have something to sit against, with a darker border to lift the whole
        // thing off the page behind it. The cap matches the other boards: the
        // stage hands out at most 620px minus its own padding, so a larger
        // number here would be a ceiling that could never be reached.
        "w-full max-w-[min(92vw,560px)] rounded-2xl border-2 border-slate-900 bg-slate-800 p-2 shadow-xl"
      )}
    >
      <div
        // The playfield. Exactly 7:6, with no padding, border or gap of its
        // own — that is what keeps the cells square. See the note above.
        className="grid w-full overflow-hidden rounded-xl"
        data-c4-playfield=""
        style={{
          aspectRatio: `${CONNECT4_COLS} / ${CONNECT4_ROWS}`,
          // One row, seven equal columns. Each column is a grid item that
          // carries its own six rows; declaring six rows *here* instead would
          // place all seven columns in the first row and leave five empty.
          gridTemplateColumns: `repeat(${CONNECT4_COLS}, minmax(0, 1fr))`,
        }}
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
              className="relative grid"
              style={{
                gridTemplateRows: `repeat(${CONNECT4_ROWS}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: CONNECT4_ROWS }, (_, y) => {
                const coord: Coordinates = { x, y };
                const cell = state[y]?.[x] ?? null;
                // A preview belongs to the column being pointed at. Matching on
                // the row alone lit up the landing slot of *every* column whose
                // disc happened to fall on the same row, so hovering one column
                // drew up to six ghosts at once.
                const isPreview = playable && hoveredColumn === x && landingRow === y;
                const latest = isLastMove(lastMove, coord);

                return (
                  <div
                    key={coordKey(coord)}
                    className={cn(
                      "flex aspect-square w-full items-center justify-center",
                      SOCKET_INSET,
                      latest && "bg-amber-400/10"
                    )}
                  >
                    {/* The socket: the empty hole, cut into the frame. */}
                    <div
                      className={cn(
                        "relative w-full rounded-full bg-slate-950",
                        "shadow-[inset_0_2px_5px_rgba(0,0,0,0.75)]",
                        // The last move is marked on the socket, because the
                        // socket is the one part of a cell with room to glow.
                        latest && "ring-2 ring-amber-400"
                      )}
                      style={{ aspectRatio: "1 / 1" }}
                    >
                      {cell !== null ? (
                        <Disc color={cell} />
                      ) : isPreview ? (
                        // A translucent disc sitting in the slot the disc will
                        // actually land in, rather than an outline in the middle
                        // of an empty column: the point of the preview is to
                        // show *where it falls*, and the landing slot is the
                        // one place that is genuinely in question.
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 animate-pulse rounded-full border-2 border-white/45 bg-white/20"
                        />
                      ) : null}
                    </div>
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
                  "absolute inset-0 z-10 rounded-xl",
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
                onMouseLeave={() =>
                  setHoveredColumn((current) => (current === x ? null : current))
                }
                onFocus={() => setHoveredColumn(x)}
                onBlur={() => setHoveredColumn((current) => (current === x ? null : current))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
