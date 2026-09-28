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
 * Each rail is captioned, because a rail on its own says *which* edges and not
 * *whose*: a player who cannot tell Black's goal from White's cannot play the
 * game, however obvious the difference looks from inside one. A caption names
 * the edge in words and points an arrow at it, and the arrows are drawn rather
 * than typed so they are the same shape on every device.
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

/** Thickness of a rail, in pixels. Fixed for the same reason. */
const RAIL_THICKNESS = 9;

/** The rails, as (colour, which edges) — see the module note. */
const BLACK_RAIL = "bg-neutral-900";
const WHITE_RAIL = "border border-neutral-300 bg-neutral-50";

/** Shared caption styling. Ten-point, tracked out, and never below 4.5:1. */
const CAPTION_CLASS = "text-[9px] font-semibold uppercase leading-none tracking-[0.12em] text-neutral-700";

type ArrowDirection = "up" | "down" | "left" | "right";

const ARROW_ROTATION: Readonly<Record<ArrowDirection, number>> = {
  up: 0,
  right: 90,
  down: 180,
  left: 270,
};

/**
 * The arrow that points at the edge its caption names.
 *
 * Drawn rather than typed. A glyph is whatever font the device happens to
 * resolve, and these arrows are load-bearing: they are how a caption says which
 * way its rail lies. One path rotated about its own centre is the same shape
 * everywhere and costs one node instead of a webfont's worth of coverage.
 */
function EdgeArrow({ direction, className }: { readonly direction: ArrowDirection; readonly className?: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("size-2.5 shrink-0", className)}
      style={{ transform: `rotate(${ARROW_ROTATION[direction]}deg)` }}
    >
      <path
        d="M12 20V5M12 5L5.5 11.5M12 5l6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The bar along one edge. Decorative: the caption beside it carries the meaning. */
function EdgeRail({ edge, side }: { readonly edge: "black" | "white"; readonly side: EdgeSide }): React.ReactElement {
  const isHorizontal = side === "top" || side === "bottom";
  return (
    <span
      aria-hidden="true"
      data-edge-rail={`${edge}-${side}`}
      className={cn(
        RAIL_CLASS,
        edge === "black" ? BLACK_RAIL : WHITE_RAIL,
        // A side rail runs the full height of the board and a top or bottom rail
        // the full width of it. `self-stretch` rather than a percentage height:
        // it is the cross-axis size, so it fills the strip whatever the caption
        // beside it measures.
        isHorizontal ? "w-full shrink-0" : "self-stretch shrink-0"
      )}
      style={isHorizontal ? { height: RAIL_THICKNESS } : { width: RAIL_THICKNESS }}
    />
  );
}

/** Which of the four edges a caption belongs to. */
type EdgeSide = "top" | "bottom" | "left" | "right";

/** The word each caption spells out. Kept next to the arrows it shares a row with. */
const EDGE_LABEL = "Black Goal Edge";
const OPPONENT_EDGE_LABEL = "White Goal Edge";

/**
 * A goal edge, drawn as caption + arrow + rail.
 *
 * The arrow always points *inwards*, at the rail its own caption sits beside,
 * so the pairing is read off the layout instead of guessed at: the caption
 * above the top rail points down, the one below the bottom rail points up, and
 * the two side captions point at the board from either side. An arrow that
 * pointed outwards would name the neighbouring edge, which is the one thing
 * this caption must never do.
 *
 * The two orientations are separate components rather than one with a branch:
 * a side caption runs *down* its strip, so its words are set vertically while
 * the arrows stay upright around them. Rotating one horizontal caption instead
 * would rotate its arrows with it and turn them into a caption for the
 * opposite edge.
 */
function HorizontalGoalEdge({ side, edge }: { readonly side: "top" | "bottom"; readonly edge: "black" | "white" }): React.ReactElement {
  const arrow: ArrowDirection = side === "top" ? "down" : "up";
  return (
    <div
      data-goal-edge={`${edge}-${side}`}
      className="flex flex-col items-center gap-1"
      style={{ gridArea: side === "top" ? "1 / 2" : "3 / 2" }}
    >
      <span className={cn("flex items-center gap-1", CAPTION_CLASS)}>
        <EdgeArrow direction={arrow} />
        {edge === "black" ? EDGE_LABEL : OPPONENT_EDGE_LABEL}
        <EdgeArrow direction={arrow} />
      </span>
      <EdgeRail edge={edge} side={side} />
    </div>
  );
}

/** A side caption, set vertically down the rail it labels. */
function VerticalGoalEdge({ side, edge }: { readonly side: "left" | "right"; readonly edge: "black" | "white" }): React.ReactElement {
  const arrow: ArrowDirection = side === "left" ? "right" : "left";
  return (
    <div
      data-goal-edge={`${edge}-${side}`}
      className="flex items-center gap-1"
      style={{ gridArea: `2 / ${side === "left" ? 1 : 3}` }}
    >
      {side === "left" ? <EdgeRail edge={edge} side={side} /> : null}
      <span className={cn("flex flex-col items-center gap-1", CAPTION_CLASS)}>
        <EdgeArrow direction={arrow} />
        <span data-edge-words="" className="whitespace-nowrap [writing-mode:vertical-rl]">
          {edge === "black" ? EDGE_LABEL : OPPONENT_EDGE_LABEL}
        </span>
        <EdgeArrow direction={arrow} />
      </span>
      {side === "right" ? <EdgeRail edge={edge} side={side} /> : null}
    </div>
  );
}

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
  winningSquares,
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
          // A captioned rail track on every side of the board. The tracks are
          // `auto` rather than a fixed number of pixels because each one now
          // holds a caption as well as a bar, and the caption is the part that
          // has to stay legible. The middle row is `auto` too, so the board
          // takes its own measured height from its 10:7 ratio instead of the
          // rails having to guess it.
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          gridTemplateRows: "auto minmax(0, 1fr) auto",
          columnGap: "3px",
          rowGap: "3px",
        }}
      >
        <HorizontalGoalEdge side="top" edge="black" />
        <HorizontalGoalEdge side="bottom" edge="black" />
        <VerticalGoalEdge side="left" edge="white" />
        <VerticalGoalEdge side="right" edge="white" />

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
              className="absolute grid"
              style={{
                // 7 cells of the 10-cell board width, shifted by half a cell per
                // row, and each row exactly one seventh of the board's height.
                // All three are exact fractions of the board, so the rhombus
                // survives any resize without a single hard-coded pixel.
                //
                // `top` is what makes the rhombus a rhombus. Without it every row
                // is absolutely positioned at `top: 0` and all 49 stones pile
                // into one overlapping line across the top edge — the rows were
                // measured correctly and then all drawn on top of each other.
                width: `${(7 / 10) * 100}%`,
                height: `${(1 / HEX_SIZE) * 100}%`,
                top: `${(y / HEX_SIZE) * 100}%`,
                left: `${(y / 2 / 10) * 100}%`,
                gridTemplateColumns: `repeat(${HEX_SIZE}, minmax(0, 1fr))`,
              }}
            >
              {rows.map((x) => {
                const coord: Coordinates = { x, y };
                const key = coordKey(coord);
                const role = roles.get(key) ?? "plain";
                const cell = state[y]?.[x] ?? null;
                const isWinning = winningSquares?.has(key) ?? false;

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
                      ...(isWinning ? ["part of the winning chain"] : []),
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
                    // The chain of stones that joined two opposite edges, ringed
                    // and washed the same way every other board rings its win.
                    // Hex's own stone colour is the only thing that changes when
                    // it is a player's turn, so the chain needs an extra signal to
                    // be readable at a glance on a board this busy.
                    isWinning={isWinning}
                    onClick={() => onSquareActivate(coord)}
                    className={cn(
                      // `group` so the ghost stone can key off the tile's own
                      // hover rather than a second listener.
                      "group",
                      // Padding, not gap: a grid gap would shrink the cells
                      // and the row would no longer be 10 cells wide across the
                      // board, which is the one number the rhombus rests on.
                      "p-[4%]",
                      // EVERY cell carries a visible boundary, filled or empty.
                      // This board is 49 near-white discs on a white canvas, and
                      // a disc with a transparent background and no border is not
                      // a subtle cell — it is not there. All 40-odd empty cells
                      // disappeared at once, which hid the entire legal move set
                      // behind what looked like a blank rhombus.
                      //
                      // A hairline border rather than a heavier one: at 49 cells
                      // the boundaries have to read as a grid without the grid
                      // competing with the stones sitting on it.
                      "rounded-full border border-neutral-300 bg-neutral-100/80 shadow-sm",
                      // A filled cell paints its own stone, so the cell's own fill
                      // and shadow would only show as a ring around it.
                      cell !== null && "border-transparent bg-transparent shadow-none",
                      // A cursor is the only affordance an empty Hex cell needs;
                      // the fill wash itself goes through `hoverWashClass` below,
                      // because a second `hover:bg-*` here would leave two on one
                      // element and hand the winner to stylesheet order.
                      !disabled && cell === null && "cursor-pointer",
                      lastMoveWash(role)
                    )}
                    hoverWashClass={
                      !disabled && cell === null
                        ? "hover:border-neutral-400 hover:bg-neutral-200/90"
                        : "hover:bg-transparent"
                    }
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
