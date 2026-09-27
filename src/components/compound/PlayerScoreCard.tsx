"use client";

/**
 * Section 3.7 — the per-seat panel.
 *
 * One card per player. The card is the only place that says whose turn it is,
 * so the "to move" treatment is deliberately loud — a filled dot, a ring, and
 * a text label rather than colour alone — and the idle state stays quiet
 * enough that the two cards read as a set.
 */

import {
  GameKind,
  MatchStatus,
  PlayerColor,
  SessionMode,
  winnerFromStatus,
} from "@/engine/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/primitives/Badge";

export interface PlayerScoreCardProps {
  readonly color: PlayerColor;
  /** `true` when this seat is the one held by this browser. */
  readonly isLocalSeat: boolean;
  /** `true` when it is this seat's turn to move. */
  readonly isToMove: boolean;
  readonly status: MatchStatus;
  /** Piece counts for the games that have them; omitted where they do not. */
  readonly pieceCounts?: Readonly<Record<PlayerColor, number>>;
  /** Wall-clock or move count, shown as the secondary line. */
  readonly detail?: string;
  /** `false` when the seat is still open, e.g. a room nobody has joined. */
  readonly isSeated: boolean;
  readonly gameKind: GameKind;
  readonly mode: SessionMode;
}

/**
 * Seats are named by colour everywhere in the product — the schema columns are
 * `player_black_token`/`player_white_token` and the sync payloads say `black`
 * and `white` — so the UI uses the same two names rather than inventing a
 * per-game vocabulary that would not match anything the player sees elsewhere.
 */
function seatLabel(color: PlayerColor): string {
  return color === "black" ? "Black" : "White";
}

export function PlayerScoreCard({
  color,
  isLocalSeat,
  isToMove,
  status,
  pieceCounts,
  detail,
  isSeated,
  gameKind,
  mode,
}: PlayerScoreCardProps): React.ReactElement {
  const winner = winnerFromStatus(status);
  const isWinner = winner !== null && winner === color;
  const isLoser = winner !== null && winner !== color;
  const isFinished = winner !== null || status === "draw";

  const statusLabel = isToMove
    ? "To move"
    : isWinner
      ? "Won"
      : isLoser
        ? "Lost"
        : isFinished
          ? "Draw"
          : "Waiting";

  const badgeTone = isWinner ? "live" : isToMove ? "pending" : isFinished ? "error" : "neutral";

  return (
    <div
      data-seat={color}
      data-to-move={isToMove ? "true" : undefined}
      data-local={isLocalSeat ? "true" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-150",
        isToMove
          ? "border-board-dark bg-board-subtle"
          : "border-hairline bg-board-light",
        isWinner && "border-success/60 bg-success/10"
      )}
    >
      {/* The seat marker repeats the board's own colour language. A ring, not
          a fill, keeps it legible on both the light and the dark card. */}
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full border-2 transition-transform duration-150",
          color === "black" ? "border-board-dark bg-board-dark" : "border-board-light bg-board-light",
          isToMove && "scale-110 ring-2 ring-board-muted ring-offset-2 ring-offset-board-light"
        )}
      >
        <span
          className={cn(
            "block size-2.5 rounded-full",
            color === "black" ? "bg-board-light" : "bg-board-dark"
          )}
        />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-board-dark">
          {seatLabel(color)}
          {isLocalSeat ? (
            <span className="ml-1.5 text-xs font-normal text-board-muted">(you)</span>
          ) : null}
        </p>
        <p className="truncate text-xs text-board-muted">
          {!isSeated
            ? mode === "online_realtime"
              ? "Waiting for an opponent"
              : "No seat taken"
            : (detail ?? (isSeated ? statusLabel : "Open"))}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {pieceCounts ? (
          <span
            className="text-sm font-medium tabular-nums text-board-dark"
            aria-label={`${pieceCounts[color]} pieces`}
          >
            {pieceCounts[color]}
          </span>
        ) : null}
        <Badge tone={badgeTone} withDot={isToMove} dotMotion={isToMove ? "pulse" : "none"}>
          {isToMove ? "Turn" : isWinner ? "Won" : isFinished ? "Done" : "Wait"}
        </Badge>
      </div>
    </div>
  );
}
