"use client";

/**
 * Phase 3.1 — the responsive layout framework.
 *
 * The four breakpoints the plan names, and what each one commits to:
 *
 *   < 768px  `flex-col`. The board takes the full width and the side panel
 *            stacks directly underneath it. The board itself is capped at
 *            `min(92vw, 34rem)` so it never touches the viewport edge on a
 *            360/390/430px phone.
 *   >= 768px `flex-row`. Board and rail are side by side, the history list is
 *            inline and capped at 480px of scroll, and the two player cards
 *            sit next to each other so a glance spans both seats.
 *   >= 1024px The board is centred in the remaining space and the rail becomes
 *            persistent rather than collapsing, so a large screen gets a fixed
 *            canvas with a column of context beside it.
 *
 * The board wrapper is the one place that knows the current cell size, and it
 * passes that down rather than letting each board guess. Sizing the board is
 * the wrapper's whole job now (see {@link BoardStage}): a board is a grid of
 * `aspect-square` cells, so one width cap serves every game and every viewport
 * instead of each board pinning itself to a fixed pixel cell size.
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
import { Button } from "@/components/primitives/Button";
import { Modal } from "@/components/primitives/Modal";
import { NetworkIndicator } from "@/components/primitives/NetworkIndicator";
import { GameOverDialog, type GameOverReason } from "@/components/compound/GameOverDialog";
import { MoveHistoryTimeline } from "@/components/compound/MoveHistoryTimeline";
import { PlayerScoreCard } from "@/components/compound/PlayerScoreCard";
import { BoardStage, type BoardCellSize } from "./BoardStage";

/**
 * Per-game rules, shown from the header.
 *
 * One of these games is two-step (Checkers: pick a piece, then pick a
 * destination) and nothing on screen says so. A player who clicks a checker
 * and sees it sit still has no way to learn that the next click is the one
 * that moves it, so the interaction model is stated here alongside the win
 * condition.
 *
 * The Hex entry has to say something the other five do not: that a tie cannot
 * happen. A player who has been told "connect the board" reasonably expects to
 * be told what happens if nobody connects it, and the honest answer is that
 * the situation is unreachable — which is a rule worth stating rather than a
 * reassurance worth implying.
 */
const GAME_RULES: Record<GameKind, { objective: string; steps: string[] }> = {
  tictactoe: {
    objective: "Line up three marks horizontally, vertically or diagonally.",
    steps: [
      "Player 1 plays Black (X); Player 2 plays White (O).",
      "Click any empty square to place your mark.",
      "The first player to complete a line of three wins.",
    ],
  },
  connect4: {
    objective: "Connect four discs in a row, column or diagonal.",
    steps: [
      "Click anywhere in a column to drop a disc into its lowest open slot.",
      "Discs fall under gravity, so a column can only fill from the bottom.",
      "The first player to form a line of four wins.",
    ],
  },
  gomoku: {
    objective: "Build an unbroken line of five stones.",
    steps: [
      "Click an intersection to place a stone. The ghost circle previews it.",
      "Lines count horizontally, vertically and on both diagonals.",
      "Exactly five or more stones in a row wins.",
    ],
  },
  reversi: {
    objective: "Finish with more discs than the opponent.",
    steps: [
      "Click a hollow marker: it brackets at least one of the opponent's discs.",
      "Every disc trapped between your new piece and another of your own flips to your colour.",
      "If you have no legal move your turn is skipped, not lost.",
    ],
  },
  checkers: {
    objective: "Capture every opponent piece, or block them from moving.",
    steps: [
      "Click one of your pieces to lift it, then click a highlighted square to land it. Both clicks are yours; the piece does not move on the first one.",
      "Click a different piece of yours to switch which one is lifted.",
      "Jump over an adjacent opponent piece into an empty square to capture it, and reaching the far edge crowns your piece as a King, which moves and captures backwards too.",
    ],
  },
  hex: {
    objective: "Connect your two opposite board sides with an unbroken chain of stones.",
    steps: [
      "Player 1 Black connects the top edge to the bottom edge; Player 2 White connects the left edge to the right edge.",
      "Click any open hex to place your stone. Chains join through all six neighbouring hexes, so the diagonals count.",
      "Draws are mathematically impossible: the first player to complete a chain always wins.",
    ],
  },
};

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
  const rules = GAME_RULES[gameKind];

  // Two dialogs the header owns: the rules, and the confirmation that stands
  // between a player and walking out of a live match.
  const [showHelp, setShowHelp] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const isLiveMatch = status === "active";

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
    <div
      className="flex min-h-dvh w-full flex-col bg-board-light text-board-dark"
      // A page that grows past the viewport height gets a scrollbar, and a
      // scrollbar takes width. Reserving its gutter permanently means the board
      // and the rail are laid out against the same width whether or not the
      // page is currently scrollable — otherwise the first move that lengthens
      // the history list shifts the entire board sideways.
      style={{ scrollbarGutter: "stable" }}
    >
      {/* Top bar: the way out and the way to the rules on the left, identity in
          the middle, connection truth on the right. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-hairline bg-board-light/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-board-light/80 sm:px-4">
        <button
          type="button"
          onClick={() => (isLiveMatch ? setConfirmExit(true) : onBackToLobby())}
          aria-label="Back to games"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-hairline px-2 py-1.5 text-xs font-medium text-board-dark transition-colors hover:bg-board-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-board-dark"
        >
          <span aria-hidden="true">&larr;</span>
          <span className="hidden sm:inline">Games</span>
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold leading-tight sm:text-base">
            {metadata.name}
          </h1>
          <p className="truncate text-xs text-board-muted">
            {mode === "offline_local"
              ? `${metadata.gridLabel} · Pass & play`
              : `${metadata.gridLabel} · ${roomId ? `Room ${roomId.slice(0, 8)}` : "Realtime match"}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="rounded-md border border-hairline px-2 py-1.5 text-xs font-medium text-board-dark transition-colors hover:bg-board-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-board-dark"
          >
            How to play
          </button>

          {isSharedLink && onCopyLink ? (
            <button
              type="button"
              onClick={onCopyLink}
              className="hidden rounded-md border border-hairline px-2.5 py-1.5 text-xs font-medium text-board-dark transition-colors hover:bg-board-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-board-dark sm:inline-flex"
            >
              Copy link
            </button>
          ) : null}

          <NetworkIndicator
            connection={connection}
            isOnline={isOnline}
            pendingCount={pendingCount}
            syncState={syncState}
            className="shrink-0"
          />
        </div>
      </header>

      {/* Section 3.1: `flex-col` below md, `flex-row` at md and up.
          `items-start` pins both columns to the top so a growing rail grows
          downward only, and `justify-center` centres the pair as a unit in the
          space left over. */}
      <main className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col items-center gap-6 p-4 md:flex-row md:items-start md:justify-center md:gap-8 md:p-6">
        {/* The board column expands to take all remaining space alongside the 320px rail */}
        <div className="flex w-full min-w-0 flex-1 flex-col items-center gap-4">
          {boardHeader}

          <BoardStage gameKind={gameKind} size={cellSize} isDesktop={isDesktop}>
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

      <Modal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title={`How to play ${metadata.name}`}
        description={rules.objective}
        panelClassName="max-w-md"
        footer={
          <Button variant="primary" onClick={() => setShowHelp(false)}>
            Got it
          </Button>
        }
      >
        <ol className="space-y-3">
          {rules.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-relaxed text-board-dark/85">
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-board-subtle font-mono text-[11px] font-semibold text-board-dark"
              >
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Modal>

      {/* Leaving a live match is the one navigation that can cost a player the
          game, so it asks first. A finished match exits straight away — the
          dialog is still on screen offering exactly this. */}
      <Modal
        open={confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Leave this match?"
        description={
          mode === "offline_local"
            ? "The position is saved on this device, so you can pick it up from the games list again."
            : "Your opponent keeps the match open until it times out, and anything you have already played stays on the board."
        }
        panelClassName="max-w-sm"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmExit(false)}>
              Keep playing
            </Button>
            <Button variant="primary" onClick={onBackToLobby}>
              Leave match
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-board-dark/80">
          {mode === "offline_local"
            ? "This is not a loss and nothing is scored — you can come back to it."
            : "Nothing is scored by leaving, but the match stays paused for you."}
        </p>
      </Modal>

      <GameOverDialog
        outcome={outcome}
        gameKind={gameKind}
        mode={mode}
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
