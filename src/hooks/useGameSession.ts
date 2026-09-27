"use client";

/**
 * Section 4.2 — the single owner of a match's live state.
 *
 * Every mutation a player can make funnels through this hook, and every
 * mutation has the same shape: re-derive the board locally with the rule
 * engine, append a `MoveRecord`, bump `version`, then write the session and its
 * queue row to IndexedDB in one transaction before touching the network. If
 * the write or the drain fails the move is already durable locally, so the UI
 * never rolls back and the queue simply retries.
 *
 * The hook also owns *selection*, because selection is a property of the game
 * state rather than of any one board view. `makeMove` therefore accepts a
 * single coordinate and decides for itself whether that coordinate is a piece
 * to pick up or a square to drop on — the caller never needs to know whether
 * the game uses origin squares.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  assertBoardSnapshot,
  boardStatesEqual,
  canLocalPlayerAct,
  coordinatesEqual,
  Coordinates,
  encodeMovePayload,
  GameKind,
  GameSession,
  isCoordinates,
  matchStatusFromResult,
  MatchStatus,
  MoveRecord,
  opponentOf,
  PlayerColor,
  SessionMode,
  UniversalBoard,
} from "@/engine/types";
import {
  getSessionEngine,
  NormalizedMove,
  replayMoves,
  SessionEngine,
} from "@/engine/factory";
import { createId, describeError } from "@/lib/utils";
import { isLocalDbAvailable } from "@/lib/db";
import { createSyncQueueItem, dispatchMoveMutation, type FlushSummary } from "@/lib/sync";
import { playCue, type SoundCue } from "@/lib/sound";

/** Why the last attempted move was refused, or null when it was accepted. */
export type MoveRejection =
  | "not-your-turn"
  | "game-over"
  | "offline-online-required"
  | "sync-conflict"
  | "illegal-move"
  | "storage-unavailable";

export interface MakeMoveOutcome {
  readonly accepted: boolean;
  readonly reason: MoveRejection | null;
  /** Human-readable text for the status line, always present. */
  readonly message: string;
  /** Set when the move ended the match. */
  readonly cue?: SoundCue;
}

export interface CreateSessionInput {
  readonly gameKind: GameKind;
  readonly mode: SessionMode;
  /** Token the local browser holds; it is the only seat this client owns. */
  readonly playerBlackToken: string;
  readonly playerWhiteToken?: string | null;
  /** Which seat this browser plays, in a two-seat realtime room. */
  readonly localSeat?: PlayerColor;
  readonly id?: string;
  readonly now?: number;
}

export interface UseGameSessionOptions {
  /**
   * Called after every accepted state change so the owner can persist, replay
   * sounds, or push the board into a realtime channel. Receives the session as
   * it will be written, never the pre-mutation value.
   */
  readonly onCommitted?: (session: GameSession, record: MoveRecord | null) => void;
  /** Called when a move is refused, for the transient error toast. */
  readonly onRejected?: (rejection: MoveRejection, message: string) => void;
  /** Disables sound cues, e.g. while a modal is open. */
  readonly muted?: boolean;
  /** Mutes specific cues without unmounting the hook. */
  readonly mutedCues?: ReadonlySet<SoundCue>;
}

export interface UseGameSessionResult {
  readonly session: GameSession | null;
  readonly engine: SessionEngine;
  readonly board: UniversalBoard;
  readonly localSeat: PlayerColor;
  /** The seat whose turn it is, resolved from the session. */
  readonly currentTurn: PlayerColor;
  readonly selected: Coordinates | null;
  readonly selectableSquares: ReadonlySet<string>;
  readonly legalSquares: ReadonlySet<string>;
  readonly destinations: ReadonlySet<string>;
  /** The last accepted move, highlighted on the board. */
  readonly lastMove: MoveRecord | null;
  readonly isThinking: boolean;
  readonly rejection: MoveRejection | null;
  readonly rejectionMessage: string | null;
  /** True while the board refuses all input. */
  readonly isLocked: boolean;
  readonly canAct: boolean;

  /** The unified dispatcher: pass a destination, or an origin for a capture. */
  readonly makeMove: (coord: Coordinates, origin?: Coordinates) => Promise<MakeMoveOutcome>;
  readonly selectSquare: (coord: Coordinates) => void;
  readonly clearSelection: () => void;
  readonly resign: () => Promise<MakeMoveOutcome>;
  readonly resetGame: () => Promise<MakeMoveOutcome>;
  readonly acknowledgeRejection: () => void;
  /** Replaces the session wholesale, used by the realtime layer after a replay. */
  readonly adoptSession: (session: GameSession) => void;
}

function coordKey(coord: Coordinates): string {
  return `${coord.x},${coord.y}`;
}

function toKeySet(coords: readonly Coordinates[]): ReadonlySet<string> {
  return new Set(coords.map(coordKey));
}


/**
 * Builds the initial session for a brand new match. Kept outside the hook so
 * the game-setup route can create a room before React mounts.
 */
export function createGameSession(input: CreateSessionInput): GameSession {
  const engine = getSessionEngine(input.gameKind);
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? createId(),
    gameKind: input.gameKind,
    mode: input.mode,
    status: "active",
    playerBlackToken: input.playerBlackToken,
    playerWhiteToken: input.playerWhiteToken ?? null,
    currentTurn: "black",
    turnNumber: 0,
    boardSnapshot: engine.createInitialBoard(),
    history: [],
    winner: null,
    createdAt: now,
    updatedAt: now,
    syncState: "synced",
    version: 1,
  };
}

export function useGameSession(
  initialSession: GameSession | null,
  options: UseGameSessionOptions = {}
): UseGameSessionResult {
  const { onCommitted, onRejected, muted = false, mutedCues } = options;

  const [session, setSession] = useState<GameSession | null>(initialSession);
  const [selected, setSelected] = useState<Coordinates | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [rejection, setRejection] = useState<MoveRejection | null>(null);
  const [rejectionMessage, setRejectionMessage] = useState<string | null>(null);

  const sessionRef = useRef<GameSession | null>(initialSession);
  const selectedRef = useRef<Coordinates | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // A new session means a new game: any pending selection belongs to the old
  // one and would point at an unrelated square.
  useEffect(() => {
    setSelected(null);
  }, [session?.id]);

  const gameKind: GameKind = session?.gameKind ?? "tictactoe";
  const engine = useMemo(() => getSessionEngine(gameKind), [gameKind]);

  const localSeat = useMemo<PlayerColor>(() => {
    if (!session) return "black";
    return session.playerWhiteToken ? "white" : "black";
  }, [session?.playerWhiteToken, session]);

  const board = session?.boardSnapshot ?? engine.createInitialBoard();
  const currentTurn = session?.currentTurn ?? "black";

  const canAct =
    session !== null &&
    canLocalPlayerAct(session, localSeat);

  const isLocked = session === null || !canAct;

  const selectableSquares = useMemo<ReadonlySet<string>>(() => {
    if (!session || isLocked) return new Set();
    return toKeySet(engine.getSelectableSquares(board, localSeat));
  }, [engine, board, localSeat, session, isLocked]);

  const legalSquares = useMemo<ReadonlySet<string>>(() => {
    if (!session || isLocked) return new Set();
    return toKeySet(engine.getLegalSquares(board, localSeat));
  }, [engine, board, localSeat, session, isLocked]);

  const destinations = useMemo<ReadonlySet<string>>(() => {
    if (isLocked || !selected) return new Set();
    return toKeySet(engine.getDestinations(board, selected, localSeat));
  }, [engine, board, selected, localSeat, isLocked]);

  const lastMove = session?.history.length ? (session.history[session.history.length - 1] ?? null) : null;

  const cue = useCallback(
    (name: SoundCue) => {
      if (optionsRef.current.muted) return;
      if (optionsRef.current.mutedCues?.has(name)) return;
      playCue(name);
    },
    []
  );

  const reject = useCallback(
    (reason: MoveRejection, message: string): MakeMoveOutcome => {
      setRejection(reason);
      setRejectionMessage(message);
      optionsRef.current.onRejected?.(reason, message);
      if (reason === "illegal-move" || reason === "not-your-turn") cue("invalid");
      return { accepted: false, reason, message };
    },
    [cue]
  );

  /**
   * Persists the next session state together with its queue row and then, for
   * realtime rooms, drains the queue. A local session stops after the
   * transaction — there is no server to talk to.
   */
  const commit = useCallback(
    async (
      next: GameSession,
      queueItem: Parameters<typeof createSyncQueueItem> | null,
      record: MoveRecord | null
    ): Promise<void> => {
      if (!isLocalDbAvailable()) {
        // Without IndexedDB the match still plays in memory; it simply cannot
        // be reopened later, and the status line says so.
        setRejection("storage-unavailable");
        setRejectionMessage("This browser blocked local storage, so this match will not be saved.");
      }
      setSession(next);
      sessionRef.current = next;
      optionsRef.current.onCommitted?.(next, record);
      if (queueItem === null) return;
      await dispatchMoveMutation(next, createSyncQueueItem(...queueItem));
    },
    []
  );

  /**
   * The unified dispatcher from plan item 4.2.
   *
   * With an `origin` it completes a capture. Without one it either picks up a
   * piece the player owns or drops onto one of the currently legal squares —
   * choosing per click rather than exposing two different call sites to the
   * board views.
   */
  const makeMove = useCallback(
    async (coord: Coordinates, origin?: Coordinates): Promise<MakeMoveOutcome> => {
      const active = sessionRef.current;
      if (!active) {
        return reject("game-over", "There is no match in progress.");
      }
      if (!isCoordinates(coord)) {
        return reject("illegal-move", "That is not a square on the board.");
      }
      if (active.syncState === "conflict") {
        return reject(
          "sync-conflict",
          "This match is out of step with the server, so play is paused."
        );
      }
      if (active.status !== "active") {
        return reject("game-over", "This match is already finished.");
      }
      if (active.currentTurn !== localSeat) {
        return reject("not-your-turn", "It is your opponent's turn.");
      }
      if (active.mode === "online_realtime" && typeof navigator !== "undefined" && !navigator.onLine) {
        return reject("offline-online-required", "Reconnect to play an online match.");
      }

      const currentEngine = getSessionEngine(active.gameKind);
      const from = origin ?? resolveOrigin(currentEngine, active.boardSnapshot, coord, localSeat, selectedRef.current);
      const move: NormalizedMove = { to: coord, ...(from ? { from } : {}) };

      let outcome: ReturnType<SessionEngine["applyMove"]>;
      try {
        outcome = currentEngine.applyMove(active.boardSnapshot, move, localSeat);
      } catch (error) {
        return reject("illegal-move", describeError(error, "That move is not allowed."));
      }

      const nextPlayer = outcome.passesTurn ? localSeat : opponentOf(localSeat);
      const now = Date.now();
      const record: MoveRecord = {
        id: createId(),
        gameId: active.id,
        ply: active.turnNumber + 1,
        player: localSeat,
        to: move.to,
        // `passesTurn` rides along in the payload: a reconnecting client
        // replays the move list alone and would otherwise have no way to
        // learn that a Reversi pass kept the turn with the same player.
        payload: encodeMovePayload({
          notation: currentEngine.formatMove(move),
          passesTurn: outcome.passesTurn,
        }),
        timestamp: now,
        ...(move.from ? { from: move.from } : {}),
      };

      const nextStatus: MatchStatus = matchStatusFromResult(outcome.winner, outcome.isDraw);
      const resolvedWinner = outcome.winner;

      const next: GameSession = {
        ...active,
        status: nextStatus,
        currentTurn: nextPlayer,
        turnNumber: active.turnNumber + 1,
        boardSnapshot: outcome.board,
        history: [...active.history, record],
        winner: resolvedWinner,
        updatedAt: now,
        version: active.version + 1,
        // A move is only as synced as the write that carries it.
        syncState: active.mode === "online_realtime" ? "pending_upload" : "synced",
      };

      setSelected(null);
      selectedRef.current = null;
      setRejection(null);
      setRejectionMessage(null);

      const terminalCue = terminalCueFor(resolvedWinner, outcome.isDraw, localSeat);
      if (terminalCue) cue(terminalCue);
      else cue(outcome.passesTurn ? "sync" : "move");

      setIsThinking(true);
      try {
        await commit(
          next,
          active.mode === "online_realtime"
            ? [active.id, "MOVE" as const, record, record.id, localSeat, now]
            : null,
          record
        );
      } catch (error) {
        // The move is already durable in `next`; a failure here only means the
        // server copy lags, which the queue and the status line both report.
        setRejectionMessage(describeError(error, "The move is saved locally but not yet uploaded."));
      } finally {
        setIsThinking(false);
      }

      return {
        accepted: true,
        reason: null,
        message: terminalCue
          ? terminalMessage(resolvedWinner, localSeat)
          : outcome.passesTurn
            ? "The opponent has no move left, so the turn passes back to you."
            : `${currentEngine.formatMove(move)} — ${currentEngine.formatSquare(coord)}`,
        ...(terminalCue ? { cue: terminalCue } : {}),
      };
    },
    [commit, cue, localSeat, reject]
  );

  const selectSquare = useCallback(
    (coord: Coordinates) => {
      if (isLocked) return;
      setSelected(coord);
      selectedRef.current = coord;
    },
    [isLocked]
  );

  const clearSelection = useCallback(() => {
    setSelected(null);
    selectedRef.current = null;
  }, []);

  const resign = useCallback(async (): Promise<MakeMoveOutcome> => {
    const active = sessionRef.current;
    if (!active || active.status !== "active") {
      return reject("game-over", "This match is already finished.");
    }
    const now = Date.now();
    // The resigner loses, so the opponent's colour is the recorded winner.
    const winner = opponentOf(localSeat);
    const next: GameSession = {
      ...active,
      status: matchStatusFromResult(winner, false),
      winner,
      updatedAt: now,
      version: active.version + 1,
      syncState: active.mode === "online_realtime" ? "pending_upload" : "synced",
    };
    cue("lose");
    setIsThinking(true);
    try {
      await commit(
        next,
        active.mode === "online_realtime"
          ? [active.id, "RESIGN" as const, { winner: next.winner, status: next.status }, createId(), localSeat, now]
          : null,
        null
      );
    } catch (error) {
      setRejectionMessage(describeError(error, "The result is saved locally but not yet uploaded."));
    } finally {
      setIsThinking(false);
    }
    return {
      accepted: true,
      reason: null,
      message: "You resigned this match.",
      cue: "lose",
    };
  }, [commit, cue, localSeat, reject]);

  const resetGame = useCallback(async (): Promise<MakeMoveOutcome> => {
    const active = sessionRef.current;
    if (!active) return reject("game-over", "There is no match in progress.");
    if (active.mode === "online_realtime" && active.status === "active") {
      // Resetting a live match would abandon a turn the opponent believes they
      // own, so it is a finished-match action only.
      return reject("game-over", "A match can only be reset once it has finished.");
    }
    const now = Date.now();
    const next: GameSession = {
      ...active,
      status: "active",
      currentTurn: "black",
      turnNumber: 0,
      boardSnapshot: engine.createInitialBoard(),
      history: [],
      winner: null,
      updatedAt: now,
      version: active.version + 1,
      syncState: active.mode === "online_realtime" ? "pending_upload" : "synced",
    };
    setSelected(null);
    selectedRef.current = null;
    cue("move");
    setIsThinking(true);
    try {
      await commit(
        next,
        active.mode === "online_realtime"
          ? [active.id, "RESET" as const, { status: "active", turnNumber: 0 }, createId(), localSeat, now]
          : null,
        null
      );
    } catch (error) {
      setRejectionMessage(describeError(error, "The reset is saved locally but not yet uploaded."));
    } finally {
      setIsThinking(false);
    }
    return { accepted: true, reason: null, message: "The board has been reset." };
  }, [commit, cue, engine, localSeat, reject]);

  const acknowledgeRejection = useCallback(() => {
    setRejection(null);
    setRejectionMessage(null);
  }, []);

  const adoptSession = useCallback((next: GameSession) => {
    setSession(next);
    sessionRef.current = next;
    setSelected(null);
    selectedRef.current = null;
  }, []);

  return {
    session,
    engine,
    board,
    localSeat,
    currentTurn,
    selected,
    selectableSquares,
    legalSquares,
    destinations,
    lastMove,
    isThinking,
    rejection,
    rejectionMessage,
    isLocked,
    canAct,
    makeMove,
    selectSquare,
    clearSelection,
    resign,
    resetGame,
    acknowledgeRejection,
    adoptSession,
  };
}

/**
 * Decides whether a bare click picks up a piece or drops one. A click on a
 * square the player owns while one is already selected switches the selection
 * rather than consuming a move, which is what every one of these games needs
 * for tap-tap and drag-drop to feel the same.
 */
function resolveOrigin(
  engine: SessionEngine,
  board: UniversalBoard,
  coord: Coordinates,
  player: PlayerColor,
  selected: Coordinates | null
): Coordinates | null {
  if (selected) {
    const moves = engine.getDestinations(board, selected, player);
    if (moves.some((candidate) => coordinatesEqual(candidate, coord))) return selected;
    // Not a valid destination: fall through and treat the click as a fresh
    // selection attempt.
  }
  if (engine.usesOriginSquare && contains(engine.getSelectableSquares(board, player), coord)) {
    return coord;
  }
  return null;
}

function contains(coords: readonly Coordinates[], coord: Coordinates): boolean {
  return coords.some((candidate) => coordinatesEqual(candidate, coord));
}

function terminalCueFor(
  winner: PlayerColor | null,
  isDraw: boolean,
  localSeat: PlayerColor
): SoundCue | null {
  if (isDraw) return "draw";
  if (winner === null) return null;
  return winner === localSeat ? "win" : "lose";
}

function terminalMessage(winner: PlayerColor | null, localSeat: PlayerColor): string {
  if (winner === null) return "The match ended in a draw.";
  return winner === localSeat ? "You won this match." : "Your opponent won this match.";
}

/**
 * Re-derives the board from the recorded move history and compares it with the
 * stored snapshot. This is the integrity gate the plan requires before a
 * reconnecting client is allowed to touch the board: the history is the
 * source of truth, and a snapshot that disagrees with it means the two copies
 * have diverged and play must stop.
 *
 * `replayMoves` re-derives a Reversi pass from the board itself, so no
 * `passesTurn` hint is threaded through here — a corrupt or missing hint cannot
 * make a divergent history look sound.
 */
export function verifyHistory(session: GameSession): {
  ok: boolean;
  board: UniversalBoard;
  reason: string | null;
} {
  try {
    assertBoardSnapshot(session.boardSnapshot, session.gameKind);
  } catch (error) {
    return {
      ok: false,
      board: session.boardSnapshot,
      reason: describeError(error, "The stored board is not a valid snapshot of this game."),
    };
  }

  if (session.history.length === 0) {
    return { ok: true, board: session.boardSnapshot, reason: null };
  }

  try {
    const replayed = replayMoves(session.boardSnapshot, session.history);
    const agrees = boardStatesEqual(replayed.board, session.boardSnapshot);
    return {
      ok: agrees,
      board: replayed.board,
      reason: agrees ? null : "The recorded moves do not rebuild the stored board.",
    };
  } catch (error) {
    return {
      ok: false,
      board: session.boardSnapshot,
      reason: describeError(error, "The recorded moves could not be replayed."),
    };
  }
}
