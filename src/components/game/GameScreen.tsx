"use client";

/**
 * The screen both game routes share.
 *
 * Everything here is route-agnostic. It holds the session, maps it onto
 * {@link GameShell}, and owns the controls. A route supplies `roomId` — `null`
 * for a local match, a string for a realtime one — and nothing else. That
 * single value is the only transport branch in the file: a local match never
 * opens a channel and never enqueues a mutation.
 *
 * There is deliberately no persistence code here. `useGameSession` already
 * writes every accepted transition through `dispatchMoveMutation`, which puts
 * the session and its queue row into IndexedDB in one transaction and then
 * attempts the send. This screen reports what that layer reports and never
 * writes a second queue row, because two rows for one ply is exactly the bug
 * the single-transaction write exists to prevent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createGameSession, useGameSession, type MakeMoveOutcome } from "@/hooks/useGameSession";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useSyncQueue } from "@/hooks/useSyncQueue";
import { playCue, useSound } from "@/lib/sound";
import {
  getGameMetadata,
  winnerFromStatus,
  type Coordinates,
  type GameKind,
  type GameSession,
  type PlayerColor,
  type UniversalBoard,
} from "@/engine/types";
import { createId, createSeatToken } from "@/lib/utils";
import { Button } from "@/components/primitives/Button";
import { GameShell } from "@/components/compound/GameShell";
import type { GameOverReason } from "@/components/compound/GameOverDialog";
import { TicTacToeBoardView } from "@/components/boards/TicTacToeBoardView";
import { ConnectFourBoardView } from "@/components/boards/ConnectFourBoardView";
import { GomokuBoardView } from "@/components/boards/GomokuBoardView";
import { ReversiBoardView } from "@/components/boards/ReversiBoardView";
import { CheckersBoardView } from "@/components/boards/CheckersBoardView";
import { ChessBoardView } from "@/components/boards/ChessBoardView";

export interface GameScreenProps {
  readonly gameKind: GameKind;
  /** Realtime room, or `null` for a local match. */
  readonly roomId: string | null;
  /** Seat this browser plays in an online match. Defaults to black. */
  readonly seat?: PlayerColor;
  /** Existing session to adopt — a resumed match, or a realtime room. */
  readonly initialSession?: GameSession | null;
  /**
   * Holds the board shut while the server's move log is still being verified.
   * Distinct from `syncState: "conflict"`, which means verification *failed*.
   */
  readonly locked?: boolean;
  /** Shows the "copy invite link" affordance in the top bar. */
  readonly isSharedLink?: boolean;
  readonly onCopyLink?: () => void;
  /** Supplied by the realtime route; a local match never has one. */
  readonly conflict?: {
    readonly reason: string | null;
    readonly isVerifying: boolean;
    readonly onRevalidate: () => void;
  } | null;
  /** Subscribes to verified sessions rebuilt from the server's move log. */
  readonly onAdoptRemoteSession?: (adopt: (session: GameSession) => void) => void;
}

/** Games whose board carries a material tally worth showing in the rail. */
const COUNTED_BOARDS: readonly GameKind[] = ["reversi", "checkers", "chess"];

function tallyColor(cell: unknown): PlayerColor | null {
  if (cell === "black" || cell === "white") return cell;
  if (typeof cell === "object" && cell !== null) {
    const color = (cell as { color?: unknown }).color;
    if (color === "black" || color === "white") return color;
  }
  return null;
}

/**
 * Counts both sides' pieces. Handles both board shapes the engine layer uses:
 * the nested `board[y][x]` grid and the flat arrays Tic-Tac-Toe and Reversi
 * use. Returns `undefined` for the games where a count would be meaningless,
 * so the card shows turn state alone rather than a fabricated tally.
 */
export function pieceCountsFor(
  gameKind: GameKind,
  board: UniversalBoard
): Record<PlayerColor, number> | undefined {
  if (!COUNTED_BOARDS.includes(gameKind)) return undefined;
  const rows: unknown = board.state;
  if (!Array.isArray(rows)) return undefined;
  const counts: Record<PlayerColor, number> = { black: 0, white: 0 };
  const first = rows[0];
  if (Array.isArray(first)) {
    for (const row of rows as unknown[][]) {
      for (const cell of row) {
        const color = tallyColor(cell);
        if (color) counts[color] += 1;
      }
    }
  } else {
    for (const cell of rows) {
      const color = tallyColor(cell);
      if (color) counts[color] += 1;
    }
  }
  return counts;
}

export function GameScreen({
  gameKind,
  roomId,
  seat = "black",
  initialSession = null,
  locked = false,
  isSharedLink = false,
  onCopyLink,
  conflict = null,
  onAdoptRemoteSession,
}: GameScreenProps): React.ReactElement {
  const router = useRouter();
  const isRealtime = roomId !== null;
  const metadata = getGameMetadata(gameKind);

  const [initial] = useState<GameSession | null>(initialSession);
  const { isOnline } = useNetworkStatus();
  const { play } = useSound();
  const {
    session: active,
    board,
    currentTurn,
    selected,
    selectableSquares,
    legalSquares,
    destinations,
    lastMove,
    rejectionMessage,
    isLocked,
    canAct: canActHook,
    makeMove,
    resign,
    resetGame,
    acknowledgeRejection,
    adoptSession,
  } = useGameSession(initial);

  const queue = useSyncQueue({
    autoDrain: isRealtime,
    paused: active?.syncState === "conflict",
  });

  // The route publishes its adopt function once, and re-publishing it on every
  // render would tear down and rebuild the realtime subscription each time.
  const adoptRef = useRef(adoptSession);
  adoptRef.current = adoptSession;
  useEffect(() => {
    if (!onAdoptRemoteSession) return;
    onAdoptRemoteSession((next) => adoptRef.current(next));
  }, [onAdoptRemoteSession]);

  const outcome: GameOverReason | null = useMemo(() => {
    if (!active) return null;
    if (active.syncState === "conflict") {
      return {
        kind: "conflict",
        detail: conflict?.reason ?? "The server's move log does not reproduce this board.",
      };
    }
    if (active.status === "active") return null;
    if (active.status === "abandoned") return { kind: "abandoned" };
    if (active.status === "draw") return { kind: "draw" };
    const winner = winnerFromStatus(active.status);
    return winner ? { kind: "win", winner } : null;
  }, [active, conflict?.reason]);

  /**
   * The board views are purely presentational: they report a square and
   * nothing more. `makeMove` with no origin is the single dispatcher that
   * decides whether this click picks up a piece or drops one, so the board
   * never needs to know which of the two happened.
   */
  // Either gate closes the board: a local `isLocked` (thinking, finished, or
  // conflicted) or the route's verification gate for a realtime match.
  const canAct = canActHook && !locked;

  const onSquareActivate = useCallback(
    (coord: Coordinates) => {
      if (!canAct) {
        playCue("invalid");
        return;
      }
      void (async () => {
        const result: MakeMoveOutcome = await makeMove(coord);
        if (result.accepted) play(result.cue ?? "move");
        else playCue("invalid");
      })();
    },
    [canAct, makeMove, play]
  );

  const boardNode = useMemo(() => {
    const shared = {
      board,
      selected: new Set(selected ? [`${selected.x},${selected.y}`] : []),
      legalSquares,
      selectableSquares,
      destinations,
      lastMove: lastMove ? { from: lastMove.from ?? null, to: lastMove.to } : null,
      disabled: isLocked || locked,
      onSquareActivate,
      label: `${metadata.name} board`,
    } as const;
    switch (gameKind) {
      case "tictactoe":
        return <TicTacToeBoardView {...shared} />;
      case "connect4":
        return <ConnectFourBoardView {...shared} />;
      case "gomoku":
        return <GomokuBoardView {...shared} />;
      case "reversi":
        return <ReversiBoardView {...shared} />;
      case "checkers":
        return <CheckersBoardView {...shared} />;
      case "chess":
        return <ChessBoardView {...shared} />;
    }
  }, [
    board,
    destinations,
    gameKind,
    isLocked,
    lastMove,
    locked,
    legalSquares,
    metadata.name,
    onSquareActivate,
    selectableSquares,
    selected,
  ]);

  const startNewGame = useCallback(() => {
    // A realtime room keeps the seat tokens the invite established, so the
    // new match is played by the same two people in the same channel.
    const blackToken = isRealtime
      ? (sessionStorage.getItem(`room:${roomId}:seat`) ?? createSeatToken())
      : createSeatToken();
    const whiteToken = isRealtime
      ? (sessionStorage.getItem(`room:${roomId}:opponent`) ?? null)
      : null;
    adoptSession(
      createGameSession({
        id: isRealtime && roomId ? roomId : createId(),
        gameKind,
        mode: isRealtime ? "online_realtime" : "offline_local",
        playerBlackToken: blackToken,
        playerWhiteToken: whiteToken,
        localSeat: seat,
      })
    );
  }, [adoptSession, gameKind, isRealtime, roomId, seat]);

  const handleResign = useCallback(() => {
    void resign();
  }, [resign]);

  const handleReset = useCallback(() => {
    void resetGame();
  }, [resetGame]);

  if (!active) {
    // Reachable when a `?session=` id no longer resolves, or when the realtime
    // room has not been loaded yet. Both deserve an explanation and a way
    // out rather than an empty shell.
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-board-light p-6 text-center text-board-dark">
        <h1 className="text-lg font-semibold">This match could not be opened</h1>
        <p className="max-w-sm text-sm text-board-muted">
          {isRealtime
            ? "The room has not finished loading. It will appear as soon as the move log is verified."
            : "The saved session was not found. It may have been cleared from this browser."}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push("/")}>
            Back to games
          </Button>
          <Button onClick={startNewGame}>Start a new match</Button>
        </div>
      </div>
    );
  }

  return (
    <GameShell
      gameKind={gameKind}
      mode={active.mode}
      board={boardNode}
      moves={active.history}
      lastMoveId={lastMove?.id ?? null}
      status={active.status}
      currentTurn={currentTurn}
      localSeat={seat}
      isSeated={{
        black: typeof active.playerBlackToken === "string" && active.playerBlackToken.length > 0,
        white: typeof active.playerWhiteToken === "string" && active.playerWhiteToken.length > 0,
      }}
      syncState={active.syncState}
      connection={isRealtime ? "connected" : "idle"}
      isOnline={isOnline}
      pendingCount={queue.pendingCount}
      outcome={outcome}
      onPlayAgain={startNewGame}
      onBackToLobby={() => router.push("/")}
      onRevalidate={conflict?.onRevalidate}
      isRevalidating={conflict?.isVerifying}
      conflictDetail={conflict?.reason ?? null}
      roomId={roomId}
      isSharedLink={isSharedLink}
      onCopyLink={onCopyLink}
      pieceCounts={pieceCountsFor(gameKind, board)}
      boardHeader={
        <div className="flex w-full max-w-sm flex-col gap-2">
          {rejectionMessage ? (
            <p
              role="status"
              className="rounded-md border border-error/40 bg-error/10 px-3 py-1.5 text-center text-xs text-board-dark"
            >
              {rejectionMessage}
              <button
                type="button"
                onClick={acknowledgeRejection}
                className="ml-2 underline underline-offset-2"
              >
                Dismiss
              </button>
            </p>
          ) : null}
          {queue.lastError ? (
            <p
              role="status"
              className="rounded-md border border-hairline bg-board-subtle px-3 py-1.5 text-center text-xs text-board-muted"
            >
              {queue.lastError}
              {queue.pendingCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void queue.flushNow()}
                  className="ml-2 underline underline-offset-2"
                >
                  Retry now
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
      }
      railFooter={
        <div className="flex flex-col gap-2">
          {active.status === "active" ? (
            <>
              <Button variant="secondary" size="sm" fullWidth onClick={handleResign}>
                Resign
              </Button>
              {isRealtime ? null : (
                <Button variant="secondary" size="sm" fullWidth onClick={handleReset}>
                  Restart match
                </Button>
              )}
            </>
          ) : null}
        </div>
      }
    />
  );
}
