"use client";

/**
 * Phase 3.1 — the responsive layout framework.
 *
 * The four breakpoints the plan names, and what each one commits to:
 *
 *   < 768px  `flex-col`. The board takes the full width and the side panel
 *            stacks directly underneath it. The board itself is capped at
 *            `max-w-[calc(100vw-2rem)]` so it never touches the viewport edge
 *            on a 360/390/430px phone, and because the cap is a square the
 *            board cannot overflow vertically either.
 *   >= 768px `flex-row`. Board and rail are side by side, the history list is
 *            inline and capped at 480px of scroll, and the two player cards
 *            sit next to each other so a glance spans both seats.
 *   >= 1024px The board is centred in the remaining space and the rail becomes
 *            persistent rather than collapsing, so a large screen gets a fixed
 *            canvas with a column of context beside it.
 *
 * The board wrapper is the one place that knows the current cell size, and it
 * passes that down rather than letting each board guess. Gomoku is the case
 * that matters: at 360px a 15x15 grid is ~22px per cell, far under the 44px
 * touch guideline, so the shell wraps it in a full-bleed tap-intercept
 * overlay — an invisible layer the size of the whole grid that turns a finger
 * into an aimed intersection (see {@link BoardStage}). The visible grid keeps
 * its 22px density; only the input area is enlarged.
 */

import { useEffect, useState, type ReactNode } from "react";

import {
  GameKind,
  getGameMetadata,
  MatchStatus,
  opponentOf,
  PlayerColor,
  SessionMode,
  SyncState,
} from "@/engine/types";
import { RealtimeConnectionState } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { NetworkIndicator } from "@/components/primitives/NetworkIndicator";
import { GameOverDialog, type GameOverReason } from "@/components/compound/GameOverDialog";
import { MoveHistoryTimeline } from "@/components/compound/MoveHistoryTimeline";
import { PlayerScoreCard } from "@/components/compound/PlayerScoreCard";
import { BoardStage, type BoardCellSize } from "./BoardStage";

export interface GameShellProps {
  readonly gameKind: GameKind;
  readonly mode: SessionMode;
  /** The six board views are wired in by the route, not by the shell. */
  readonly board: ReactNode;
  readonly moves: Parameters<typeof MoveHistoryTimeline>[0]["moves"];
  readonly lastMoveId: string | null;
  readonly status: MatchStatus;
  readonly currentTurn: PlayerColor;
  readonly localSeat: PlayerColor;
  readonly isSeated: Readonly<Record<PlayerColor, boolean>>;
  readonly syncState: SyncState;
  readonly connection: RealtimeConnectionState;
  readonly isOnline: boolean;
  readonly pendingCount: number;
  readonly outcome: GameOverReason | null;
  readonly onPlayAgain: () => void;
  readonly onBackToLobby: () => void;
  readonly onRevalidate?: () => void;
  readonly isRevalidating?: boolean;
  readonly conflictDetail?: string | null;
  /** Rendered in the rail under the seats, e.g. resign/reset controls. */
  readonly railFooter?: ReactNode;
  /** Renders above the board on mobile — the status strip. */
  readonly boardHeader?: ReactNode;
  /** The room id to show in the top bar when the match is online. */
  readonly roomId?: string | null;
  readonly isSharedLink?: boolean;
  readonly onCopyLink?: () => void;
  readonly pieceCounts?: Readonly<Record<PlayerColor, number>>;
}

function cellSizeFor(width: number): BoardCellSize {
  // The thresholds are the viewport classes the plan pins, not arbitrary
  // numbers: below `sm` nothing is larger than `md`, and only a genuinely
  // large viewport earns `lg` cells.
  if (width >= 1024) return "lg";
  if (width >= 640) return "md";
  return "sm";
}

export function GameShell({
  gameKind,
  mode,
  board,
  moves,
  lastMoveId,
  status,
  currentTurn,
  localSeat,
  isSeated,
  syncState,
  connection,
  isOnline,
  pendingCount,
  outcome,
  onPlayAgain,
  onBackToLobby,
  onRevalidate,
  isRevalidating,
  conflictDetail,
  railFooter,
  boardHeader,
  roomId,
  isSharedLink,
  onCopyLink,
  pieceCounts,
}: GameShellProps): React.ReactElement {
  const metadata = getGameMetadata(gameKind);

  // The shell owns the responsive decision rather than letting CSS and JS
  // disagree: CSS handles the flex direction, and this handles cell size and
  // the side-by-side seat layout, which are not expressible as a class alone
  // without duplicating the breakpoints in two places.
  const [viewportWidth, setViewportWidth] = useState<number>(0);
  useEffect(() => {
    const read = () => setViewportWidth(window.innerWidth);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const cellSize = cellSizeFor(viewportWidth);
  const isWide = viewportWidth >= 768;
  const isDesktop = viewportWidth >= 1024;

  // On mobile the player whose turn it is sits nearest the thumb; on wide
  // screens the pair spans the rail, so the opponent leads and the mover
  // follows, which is how a scoreboard reads.
  const order: readonly PlayerColor[] = isWide
    ? [opponentOf(currentTurn), currentTurn]
    : [currentTurn, opponentOf(currentTurn)];
  const counts = pieceCounts;

  return (
    <div className="flex min-h-dvh flex-col bg-board-light text-board-dark">
      {/* Top bar: identity on the left, connection truth on the right. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-hairline bg-board-light/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-board-light/80">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold leading-tight sm:text-base">
            {metadata.name}
          </h1>
          <p className="truncate text-xs text-board-muted">
            {metadata.gridLabel} · {roomId ? `Room ${roomId.slice(0, 8)}` : "Local match"}
          </p>
        </div>

        {isSharedLink && onCopyLink ? (
          <button
            type="button"
            onClick={onCopyLink}
            className="hidden shrink-0 rounded-md border border-hairline px-2.5 py-1.5 text-xs font-medium text-board-dark underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-board-dark sm:inline-flex"
          >
            Copy invite link
          </button>
        ) : null}

        <NetworkIndicator
          connection={connection}
          isOnline={isOnline}
          pendingCount={pendingCount}
          syncState={syncState}
          className="shrink-0"
        />
      </header>

      {/* Section 3.1: `flex-col` below md, `flex-row` at md and up. */}
      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
        <div className="flex min-w-0 flex-col items-center gap-3 md:flex-1">
          {boardHeader}

          <BoardStage
            gameKind={gameKind}
            size={cellSize}
            isDesktop={isDesktop}
            className="w-full max-w-[calc(100vw-2rem)] md:max-w-[min(100%,42rem)]"
          >
            {board}
          </BoardStage>

          {railFooter ? <div className="w-full max-w-sm">{railFooter}</div> : null}
        </div>

        {/* The rail. On mobile it is simply the next sibling in the column; on
            tablet and desktop it is a bounded column beside the board. */}
        <aside
          aria-label="Match panel"
          className={cn(
            "flex w-full flex-col gap-4 md:w-72 md:shrink-0 md:gap-5",
            isDesktop ? "md:sticky md:top-20 md:self-start" : "md:max-h-[calc(100dvh-6rem)]"
          )}
        >
          <div
            className={cn(
              "grid gap-2",
              // Section 5.1: side-by-side seats from 768px, stacked below it.
              isWide ? "md:grid-cols-2" : "grid-cols-1"
            )}
          >
            {order.map((color) => (
              <PlayerScoreCard
                key={color}
                color={color}
                isLocalSeat={color === localSeat}
                isToMove={status === "active" && currentTurn === color}
                status={status}
                isSeated={isSeated[color]}
                gameKind={gameKind}
                mode={mode}
                pieceCounts={counts}
                detail={
                  status === "active"
                    ? // A local match is hot-seat: the other colour is played
                      // from the same device, so "Thinking…" would describe a
                      // person who is sitting right there.
                      currentTurn === color
                        ? mode === "offline_local"
                          ? "To move"
                          : "Your turn"
                        : mode === "offline_local"
                          ? "Waiting"
                          : "Thinking…"
                    : undefined
                }
              />
            ))}
          </div>

          <MoveHistoryTimeline
            moves={moves}
            gameKind={gameKind}
            lastMoveId={lastMoveId}
            localSeat={localSeat}
            defaultCollapsed={!isWide}
            className="min-h-0"
          />
        </aside>
      </main>

      <GameOverDialog
        outcome={outcome}
        gameKind={gameKind}
        localSeat={localSeat}
        onRevalidate={onRevalidate}
        isRevalidating={isRevalidating}
        onPlayAgain={onPlayAgain}
        onBackToLobby={onBackToLobby}
        conflictDetail={conflictDetail}
      />
    </div>
  );
}
