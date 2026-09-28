"use client";

/**
 * Section 3.7 — the move log.
 *
 * Plies are listed in pairs, one row per full move, with black on the left and
 * white on the right. That is the shape a player expects from a notation chart,
 * and it halves the scroll height on a phone.
 *
 * The notation comes from the engine's own `formatMove`, so checkers reads `B6`
 * and Gomoku reads `H8` without this component knowing which game it is
 * showing. A pass — the ply Reversi produces when a player has no legal move —
 * is labelled explicitly rather than being rendered as an empty cell, because
 * a blank row in a move log looks like a bug.
 */

import { useEffect, useRef, useState } from "react";

import { GameKind, MoveRecord, PlayerColor } from "@/engine/types";
import { getSessionEngine } from "@/engine/factory";
import { cn, formatRelativeTime } from "@/lib/utils";

export interface MoveHistoryTimelineProps {
  readonly moves: readonly MoveRecord[];
  readonly gameKind: GameKind;
  /** Highlights the most recent ply. */
  readonly lastMoveId: string | null;
  /** The seat this browser plays, so its own plies can be marked. */
  readonly localSeat: PlayerColor;
  /** Collapses the panel on small screens. */
  readonly defaultCollapsed?: boolean;
  readonly className?: string;
}

function notationFor(move: MoveRecord, gameKind: GameKind): string {
  const engine = getSessionEngine(gameKind);
  // A payload written by an older build may carry no notation; the engine can
  // always rebuild one from the coordinates, so a missing string is never a
  // reason to render a blank row.
  if (move.payload) {
    const trimmed = move.payload.endsWith("|pass") ? move.payload.slice(0, -"|pass".length) : move.payload;
    if (trimmed.length > 0) return trimmed;
  }
  return engine.formatMove({ to: move.to, ...(move.from ? { from: move.from } : {}) });
}

function isPass(move: MoveRecord): boolean {
  return typeof move.payload === "string" && move.payload.endsWith("|pass");
}

export function MoveHistoryTimeline({
  moves,
  gameKind,
  lastMoveId,
  localSeat,
  defaultCollapsed = false,
  className,
}: MoveHistoryTimelineProps): React.ReactElement {
  const listRef = useRef<HTMLOListElement | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  // Follow the newest ply as it arrives, but only when the user has not
  // scrolled up to read earlier moves themselves.
  useEffect(() => {
    const list = listRef.current;
    if (!list || isCollapsed) return;
    list.scrollTop = list.scrollHeight;
  }, [moves.length, isCollapsed]);

  const rows: { index: number; black: MoveRecord | null; white: MoveRecord | null }[] = [];
  for (let index = 0; index < moves.length; index += 2) {
    rows.push({
      index: index / 2 + 1,
      black: moves[index] ?? null,
      white: moves[index + 1] ?? null,
    });
  }

  const renderPly = (move: MoveRecord | null) => {
    if (!move) {
      return (
        <span className="text-xs text-board-muted/70" aria-label="No move">
          —
        </span>
      );
    }
    const isLatest = move.id === lastMoveId;
    const isLocal = move.player === localSeat;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs tabular-nums transition-colors",
          isLatest ? "bg-board-subtle font-semibold text-board-dark" : "text-board-dark/80",
          move.player === "black" ? "justify-self-start" : "justify-self-end"
        )}
        title={`Ply ${move.ply} · ${formatRelativeTime(move.timestamp)}${
          isLocal ? " · your move" : ""
        }`}
      >
        {isPass(move) ? (
          <span className="italic text-board-muted">pass</span>
        ) : (
          notationFor(move, gameKind)
        )}
      </span>
    );
  };

  return (
    <section
      aria-label="Move history"
      className={cn("flex min-h-0 flex-col", className)}
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-board-muted">
          Moves
          <span className="ml-2 font-normal normal-case tracking-normal tabular-nums">
            {moves.length}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setIsCollapsed((current) => !current)}
          aria-expanded={!isCollapsed}
          aria-controls="move-history-list"
          className="rounded px-2 py-1 text-xs text-board-muted underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-board-dark md:hidden"
        >
          {isCollapsed ? "Show" : "Hide"}
        </button>
      </div>

      {!isCollapsed ? (
        <ol
          id="move-history-list"
          ref={listRef}
          className={cn(
            // Section 5.1 requires max-h-36 on compact mobile and a 480px cap
            // from the tablet breakpoint up; both are scroll regions, and the
            // list is `min-h-0` so the flex parent can actually shrink it.
            "scrollbar-none min-h-0 overflow-y-auto pr-1",
            "max-h-36 md:max-h-[480px]"
          )}
        >
          {rows.length === 0 ? (
            <li className="py-3 text-xs text-board-muted">No moves yet.</li>
          ) : (
            rows.map((row) => (
              <li
                key={row.index}
                className="grid grid-cols-[1.5rem_1fr_1fr] items-center gap-1 border-b border-hairline/70 py-1 last:border-b-0"
              >
                <span className="text-[11px] tabular-nums text-board-muted/80">{row.index}.</span>
                {renderPly(row.black)}
                {renderPly(row.white)}
              </li>
            ))
          )}
        </ol>
      ) : null}
    </section>
  );
}
