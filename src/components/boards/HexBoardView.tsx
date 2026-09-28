"use client";

/**
 * Section 3.6 — Hex.
 *
 * A rhombus, not a square. Seven rows of seven cells, each row shifted half a
 * cell to the right of the one above, which is what turns a 7x7 grid into the
 * board the rules are written about: the diagonals become neighbours, and a
 * chain that is broken on a square board is joined here.
 *
 * **The geometry is stated as fractions of the board, never as pixels.** The
 * board is 10 cell-widths across and 7 tall: 7 cells plus the 6 half-cell
 * offsets that the last row accumulates. Every row is therefore 70% of the
 * board's width, and row `y` starts at `y * 5%` — a fifth being half a cell of
 * a 10-cell width. Those two numbers fall out of the shape, so they cannot go
 * stale the way a `ml-[21px]` does when a gutter or a gap changes.
 *
 * Stones are circular rather than hexagonal. On a rhombic grid the six
 * neighbours of a cell are already the centres of a hexagon, and a disc is the
 * cheaper, more legible rendering of one: it never needs `clip-path`, so the
 * focus ring and the legal-target marker both survive intact — a clipped tile
 * would cut the focus ring in half and the marker with it.
 *
 * The four rails are the rule, drawn: Black's goal edges are the top and the
 * bottom, White's are the left and the right. They are laid out in the same
 * grid as the board and sized by it, so a rail is always exactly as long as
 * the edge it labels, at any viewport, with no measurement of the board
 * itself.
 *
 * **No cell is marked as a destination in advance.** In Hex every empty cell
 * is legal on every turn, so a marker per destination would be 49 dots saying
 * what the board already shows — this cell is empty. The only moment a player
 * needs to know a cell is playable is the moment the pointer is over it, so
 * that is the only moment anything is drawn. Gomoku and Connect Four are
 * marked the same way, for the same reason.
 */

import { useMemo } from "react";

import { assertBoardSnapshot, type Coordinates, type PlayerColor } from "@/engine/types";
import { HEX_SIZE } from "@/engine/rules/hex";
import { cn, formatGridSquare } from "@/lib/utils";
import { BoardTile } from "@/components/primitives/BoardTile";
import type { BoardViewProps } from "./boardViewTypes";
import { coordKey, isLastMove, lastMoveWash, type SquareRole, squareRole } from "./boardViewTypes";

/** Width of one of the four goal rails. Fixed: they label an edge, not a cell. */
const RAIL_CLASS = "rounded-sm";

/** The rails, as (colour, which edges) — see the module note. */
const BLACK_RAIL = "bg-neutral-900";
const WHITE_RAIL = "border border-neutral-300 bg-neutral-50";

/**
 * Black: jet. A near-black disc with the highlight on the upper left and the
 * shadow underneath, because a black disc on a pale board has no edge of its
 * own and has to be given one by the shading.
 */
function BlackStone(): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none relative block size-[74%] rounded-full bg-neutral-900",
        "shadow-[inset_-1px_-2px_3px_rgba(0,0,0,0.95),0_1px_2px_rgba(0,0,0,0.35)]"
      )}
    >
      <span className="absolute left-[24%] top-[15%] size-[32%] rounded-full bg-white/40" />
    </span>
  );
}

/**
 * White: pearl. Needs the dark hairline — a white disc on a near-white cell is
 * two very similar greys, and without the rim the stone is a smudge.
 */
function WhiteStone(): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none block size-[74%] rounded-full border border-neutral-400 bg-neutral-50",
        "shadow-[inset_-1px_-2px_3px_rgba(0,0,0,0.18),0_1px_2px_rgba(0,0,0,0.2)]"
      )}
    />
  );
}

function Stone({ color }: { readonly color: PlayerColor }): React.ReactElement {
  return color === "black" ? <BlackStone /> : <WhiteStone />;
}

export function HexBoardView({
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
  const state = useMemo(() => assertBoardSnapshot(board, "hex").state, [board]);

  const rows = useMemo(() => Array.from({ length: HEX_SIZE }, (_, i) => i), []);

  const roles = useMemo(() => {
    const map = new Map<string, SquareRole>();
    for (let y = 0; y < HEX_SIZE; y += 1) {
      for (let x = 0; x < HEX_SIZE; x += 1) {
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
    <div className="mx-auto w-full max-w-[min(92vw,560px)]">
      <div
        className="grid"
        style={{
          // A rail track either side of the board and a rail track above and
          // below it. The middle row is `auto`, so the rails take the board's
          // own measured height instead of guessing it.
          gridTemplateColumns: "9px minmax(0, 1fr) 9px",
          gridTemplateRows: "9px auto 9px",
          columnGap: "3px",
          rowGap: "3px",
        }}
      >
        <span aria-hidden="true" className={cn(RAIL_CLASS, BLACK_RAIL)} style={{ gridArea: "1 / 2" }} />
        <span aria-hidden="true" className={cn(RAIL_CLASS, BLACK_RAIL)} style={{ gridArea: "3 / 2" }} />
        <span aria-hidden="true" className={cn(RAIL_CLASS, WHITE_RAIL)} style={{ gridArea: "2 / 1" }} />
        <span aria-hidden="true" className={cn(RAIL_CLASS, WHITE_RAIL)} style={{ gridArea: "2 / 3" }} />

        <div
          role="grid"
          aria-label={label}
          aria-rowcount={HEX_SIZE}
          aria-colcount={HEX_SIZE}
          aria-disabled={disabled || undefined}
          className="relative w-full"
          style={{ gridArea: "2 / 2", aspectRatio: "10 / 7" }}
        >
          {rows.map((y) => (
            <div
              key={`row-${y}`}
              className="absolute top-0 grid"
              style={{
                // 7 cells of the 10-cell board width, shifted by half a cell per
                // row. Both are exact fractions of the board, so the offset
                // survives any resize without a single hard-coded pixel.
                width: `${(7 / 10) * 100}%`,
                height: `${(1 / HEX_SIZE) * 100}%`,
                left: `${(y / 2 / 10) * 100}%`,
                gridTemplateColumns: `repeat(${HEX_SIZE}, minmax(0, 1fr))`,
              }}
            >
              {rows.map((x) => {
                const coord: Coordinates = { x, y };
                const key = coordKey(coord);
                const role = roles.get(key) ?? "plain";
                const cell = state[y]?.[x] ?? null;

                // A corner cell sits on a Black edge *and* a White one, so the
                // label names both rather than letting one `||` silently drop
                // half of what makes that cell worth playing.
                const goalEdges: string[] = [];
                if (y === 0 || y === HEX_SIZE - 1) goalEdges.push("black goal edge");
                if (x === 0 || x === HEX_SIZE - 1) goalEdges.push("white goal edge");

                return (
                  <BoardTile
                    key={key}
                    label={[
                      formatGridSquare(x, y, HEX_SIZE),
                      cell === null
                        ? "empty"
                        : cell === "black"
                          ? "black stone, connects top to bottom"
                          : "white stone, connects left to right",
                      ...goalEdges,
                    ].join(", ")}
                    size={size}
                    shape="circle"
                    disabled={disabled}
                    // Hex has no pieces to pick up, so a selection ring would
                    // only ever appear on an empty cell, and an empty cell in
                    // Hex is never a choice between two things. The gold glow is
                    // kept because it is the engine's own signal; it is not the
                    // signal a Hex player reads.
                    selectedRingClass="ring-2 ring-inset ring-amber-400/90"
                    // Deliberately no destination marker. Every empty cell is
                    // legal on every turn, so 49 dots would be a full board of
                    // noise that says only what the board already shows: this
                    // cell is empty. The ghost below carries the same
                    // information only while it is the cell under the pointer,
                    // which is the one moment the player needs it. This is the
                    // same call gomoku and Connect Four make, and for the same
                    // reason — and it is why no tile here draws two marks.
                    isLegalTarget={false}
                    isLastMove={isLastMove(lastMove, coord)}
                    onClick={() => onSquareActivate(coord)}
                    className={cn(
                      // `group` so the ghost stone can key off the tile's own
                      // hover rather than a second listener. The tile's shape,
                      // hover wash and disabled treatment are left to
                      // `BoardTile`: re-stating any of them here would put two
                      // conflicting utilities on one element and hand the
                      // winner to stylesheet order.
                      "group",
                      // Padding, not gap: a grid gap would shrink the cells
                      // and the row would no longer be 10 cells wide across the
                      // board, which is the one number the rhombus rests on.
                      "p-[4%]",
                      lastMoveWash(role)
                    )}
                  >
                    {cell !== null ? (
                      <Stone color={cell} />
                    ) : disabled ? null : (
                      // The ghost: a stone-sized disc that only exists on
                      // hover, so the shape of what a tap would put down is
                      // known before the tap. It is inert — `pointer-events-none`
                      // and `aria-hidden` — so it never intercepts the click or
                      // reaches the accessible tree. A locked board renders no
                      // ghost at all, rather than relying on the pointer never
                      // arriving: a locked board must not advertise an option.
                      <span
                        aria-hidden="true"
                        className="pointer-events-none block size-[74%] rounded-full bg-neutral-500/0 transition-colors duration-100 group-hover:bg-neutral-500/30"
                      />
                    )}
                  </BoardTile>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
