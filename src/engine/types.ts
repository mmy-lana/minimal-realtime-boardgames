/**
 * Section 1.1 — Pure TypeScript domain models.
 *
 * This module is the single source of truth for every value that crosses a
 * trust boundary: React components, the IndexedDB (Dexie) store, and the
 * Supabase JSONB snapshot column. It contains no DOM access, no framework
 * imports and no I/O, so it is safe to import from server components,
 * client components, the sync layer and the rule engines alike.
 */

/* -------------------------------------------------------------------------- */
/* Primitive enums                                                            */
/* -------------------------------------------------------------------------- */

export type GameKind =
  | "tictactoe"
  | "connect4"
  | "gomoku"
  | "reversi"
  | "checkers"
  | "hex";

export type SessionMode = "offline_local" | "online_realtime";

export type PlayerColor = "black" | "white";

export type MatchStatus =
  | "waiting"
  | "active"
  | "draw"
  | "won_black"
  | "won_white"
  | "abandoned";

export type SyncState = "synced" | "pending_upload" | "conflict";

/** Ordered so iteration order is stable for UI matrices and queue drains. */
export const GAME_KINDS: readonly GameKind[] = [
  "tictactoe",
  "connect4",
  "gomoku",
  "reversi",
  "checkers",
  "hex",
] as const;

export const SESSION_MODES: readonly SessionMode[] = [
  "offline_local",
  "online_realtime",
] as const;

export const PLAYER_COLORS: readonly PlayerColor[] = ["black", "white"] as const;

export const MATCH_STATUSES: readonly MatchStatus[] = [
  "waiting",
  "active",
  "draw",
  "won_black",
  "won_white",
  "abandoned",
] as const;

export const SYNC_STATES: readonly SyncState[] = [
  "synced",
  "pending_upload",
  "conflict",
] as const;

export function isGameKind(value: unknown): value is GameKind {
  return (
    typeof value === "string" && (GAME_KINDS as readonly string[]).includes(value)
  );
}

export function isSessionMode(value: unknown): value is SessionMode {
  return (
    typeof value === "string" &&
    (SESSION_MODES as readonly string[]).includes(value)
  );
}

export function isPlayerColor(value: unknown): value is PlayerColor {
  return (
    typeof value === "string" && (PLAYER_COLORS as readonly string[]).includes(value)
  );
}

export function isMatchStatus(value: unknown): value is MatchStatus {
  return (
    typeof value === "string" && (MATCH_STATUSES as readonly string[]).includes(value)
  );
}

export function isSyncState(value: unknown): value is SyncState {
  return (
    typeof value === "string" && (SYNC_STATES as readonly string[]).includes(value)
  );
}

const OPPONENT_BY_COLOR: Readonly<Record<PlayerColor, PlayerColor>> = {
  black: "white",
  white: "black",
};

/** The single place that decides what "the other side" means. */
export function opponentOf(color: PlayerColor): PlayerColor {
  return OPPONENT_BY_COLOR[color];
}

/** Statuses after which no further move may be dispatched. */
export function isTerminalStatus(status: MatchStatus): boolean {
  return (
    status === "draw" ||
    status === "won_black" ||
    status === "won_white" ||
    status === "abandoned"
  );
}

export function isPlayableStatus(status: MatchStatus): boolean {
  return status === "active";
}

/**
 * Derives the canonical {@link MatchStatus} from an engine result so rule
 * engines, the sync queue and the Supabase RPC all agree on one encoding.
 */
export function matchStatusFromResult(
  winner: PlayerColor | null,
  isDraw: boolean,
  activeStatus: MatchStatus = "active"
): MatchStatus {
  if (isDraw) return "draw";
  if (winner === "black") return "won_black";
  if (winner === "white") return "won_white";
  return activeStatus;
}

/** Maps a finished {@link MatchStatus} back to its winner, or `null` for draws. */
export function winnerFromStatus(status: MatchStatus): PlayerColor | null {
  if (status === "won_black") return "black";
  if (status === "won_white") return "white";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Coordinates                                                                */
/* -------------------------------------------------------------------------- */

export interface Coordinates {
  x: number;
  y: number;
}

export function coordinatesEqual(
  a: Coordinates | null | undefined,
  b: Coordinates | null | undefined
): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y;
}

export function isCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return (
    Number.isInteger(candidate.x) &&
    Number.isInteger(candidate.y) &&
    (candidate.x as number) >= 0 &&
    (candidate.y as number) >= 0
  );
}

/* -------------------------------------------------------------------------- */
/* Board states                                                               */
/* -------------------------------------------------------------------------- */

export type TicTacToeCell = PlayerColor | null;
export type TicTacToeBoard = TicTacToeCell[];

export type Connect4Cell = PlayerColor | null;
export type Connect4Board = Connect4Cell[][];

export type GomokuCell = PlayerColor | null;
export type GomokuBoard = GomokuCell[][];

export type ReversiCell = PlayerColor | null;
export type ReversiBoard = ReversiCell[][];

export type CheckersPieceType = "pawn" | "king";
export interface CheckersPiece {
  color: PlayerColor;
  type: CheckersPieceType;
}
export type CheckersCell = CheckersPiece | null;
export type CheckersBoard = CheckersCell[][];

/**
 * One cell of a Hex board.
 *
 * A cell is the stone's colour or nothing — Hex has no piece types, so unlike
 * Checkers a cell is a bare `PlayerColor` rather than an object. That is what
 * makes the JSONB snapshot for a 7x7 board small enough to read at a glance and
 * cheap to compare, and it is why `boardStatesEqual` can compare two Hex
 * positions structurally without a per-cell comparator.
 */
export type HexCell = PlayerColor | null;
export type HexBoard = HexCell[][];

/**
 * Lookup table used for board-state extraction.
 *
 * `Extract<UniversalBoard, { kind: K }>["state"]` cannot serve this purpose:
 * while `K` is still a generic type parameter, TypeScript defers the
 * conditional and resolves the indexed access to an *intersection* of every
 * member's state type, which no single concrete board satisfies. An explicit
 * indexed map yields the same ergonomics with exact per-kind types.
 */
export interface BoardStateByKind {
  tictactoe: TicTacToeBoard;
  connect4: Connect4Board;
  gomoku: GomokuBoard;
  reversi: ReversiBoard;
  checkers: CheckersBoard;
  hex: HexBoard;
}

export type BoardStateFor<K extends GameKind> = BoardStateByKind[K];

/** Narrows a `UniversalBoard` to the variant tagged with `K`. */
export type TypedUniversalBoard<K extends GameKind> = {
  kind: K;
  state: BoardStateFor<K>;
};

export type UniversalBoard =
  | { kind: "tictactoe"; state: TicTacToeBoard }
  | { kind: "connect4"; state: Connect4Board }
  | { kind: "gomoku"; state: GomokuBoard }
  | { kind: "reversi"; state: ReversiBoard }
  | { kind: "checkers"; state: CheckersBoard }
  | { kind: "hex"; state: HexBoard };

/**
 * Discriminates a snapshot by kind.
 *
 * Declared as a plain `boolean` rather than a type predicate: for a generic
 * `K`, a predicate target of `{ kind: K; state: BoardStateFor<K> }` is not
 * provably a subtype of `UniversalBoard`. Use {@link assertBoardSnapshot} or
 * {@link extractTypedBoard} whenever the narrowed *value* is required.
 */
export function isBoardSnapshotOfKind(
  snapshot: UniversalBoard,
  kind: GameKind
): boolean {
  return snapshot.kind === kind;
}

/**
 * Narrows a snapshot to the variant tagged with `expectedKind`, throwing a
 * descriptive error when the kinds disagree.
 */
export function assertBoardSnapshot<K extends GameKind>(
  snapshot: UniversalBoard,
  expectedKind: K
): TypedUniversalBoard<K> {
  if (snapshot.kind !== expectedKind) {
    throw new Error(
      `Mismatched board kind: expected ${expectedKind}, received ${snapshot.kind}`
    );
  }
  return snapshot as TypedUniversalBoard<K>;
}

/* -------------------------------------------------------------------------- */
/* Safe coordinate / cell extraction                                          */
/* -------------------------------------------------------------------------- */

/**
 * Bounds-checked cell accessor shared by every rule engine and board view.
 * Out-of-range reads return `null` instead of throwing or yielding
 * `undefined`, so a malformed snapshot can never crash a render pass.
 */
export function getBoardCell<T>(
  board: readonly (readonly T[])[],
  x: number,
  y: number
): T | null {
  if (y < 0 || y >= board.length) return null;
  const row = board[y];
  if (!row || x < 0 || x >= row.length) return null;
  return row[x] ?? null;
}

/** Writes into an already-copied board; stays total for any coordinates. */
export function setBoardCell<T>(board: T[][], x: number, y: number, value: T): void {
  if (y < 0 || y >= board.length) return;
  const row = board[y];
  if (!row || x < 0 || x >= row.length) return;
  row[x] = value;
}

/** `true` when `(x, y)` addresses a cell that exists in `board`. */
export function isWithinBoard(
  board: readonly (readonly unknown[])[],
  x: number,
  y: number
): boolean {
  if (y < 0 || y >= board.length) return false;
  const row = board[y];
  return Boolean(row) && x >= 0 && x < row.length;
}

/**
 * Extracts the board state of `expectedKind` from a session, throwing a
 * descriptive error when the stored snapshot belongs to another game. Every
 * rule engine entry point goes through this so a mismatched snapshot fails
 * loudly at the boundary instead of corrupting a move.
 */
export function extractTypedBoard<K extends GameKind>(
  session: GameSession,
  expectedKind: K
): BoardStateFor<K> {
  return assertBoardSnapshot(session.boardSnapshot, expectedKind).state;
}

/* -------------------------------------------------------------------------- */
/* Moves & session lifecycle                                                  */
/* -------------------------------------------------------------------------- */

export interface MoveRecord {
  id: string;
  gameId: string;
  ply: number;
  player: PlayerColor;
  from?: Coordinates;
  to: Coordinates;
  payload?: string;
  timestamp: number;
}

/**
 * Semantic content carried by {@link MoveRecord.payload}.
 *
 * `notation` is the human-readable label shown in the history timeline.
 * `passesTurn` exists because Reversi can leave a player with no legal move —
 * that ply is still recorded, but the mover keeps the turn. The turn hand-off
 * has to survive the round trip through the `game_moves.payload` column, since
 * a reconnecting client replays from rows alone and never sees the RPC's
 * arguments.
 */
export interface MovePayload {
  notation: string;
  passesTurn: boolean;
}

const MOVE_PAYLOAD_PASS_SUFFIX = "|pass";

/**
 * Encodes a {@link MovePayload} for storage in the `payload` text column.
 *
 * The encoding is human-readable on purpose: a room's move log stays legible
 * when inspected with a plain SQL client.
 */
export function encodeMovePayload(payload: MovePayload): string {
  return payload.passesTurn
    ? `${payload.notation}${MOVE_PAYLOAD_PASS_SUFFIX}`
    : payload.notation;
}

/**
 * Decodes a {@link MoveRecord.payload} written by {@link encodeMovePayload}.
 *
 * A missing, empty or foreign payload decodes to a safe default rather than
 * throwing: a row written before this convention existed still replays, it
 * simply hands the turn over as normal.
 */
export function decodeMovePayload(raw: string | null | undefined): MovePayload {
  if (typeof raw !== "string" || raw.length === 0) {
    return { notation: "", passesTurn: false };
  }
  if (raw.endsWith(MOVE_PAYLOAD_PASS_SUFFIX)) {
    return {
      notation: raw.slice(0, -MOVE_PAYLOAD_PASS_SUFFIX.length),
      passesTurn: true,
    };
  }
  return { notation: raw, passesTurn: false };
}

export interface GameSession {
  id: string;
  gameKind: GameKind;
  mode: SessionMode;
  status: MatchStatus;
  playerBlackToken: string;
  playerWhiteToken: string | null;
  currentTurn: PlayerColor;
  turnNumber: number;
  boardSnapshot: UniversalBoard;
  history: MoveRecord[];
  winner: PlayerColor | null;
  /**
   * The cells that decided the game, or `null` while it is undecided and on a
   * draw. Optional because a row read back from a store written before this
   * field existed has no value for it — `null` and "absent" are the same fact
   * here, and a persisted session must not be rejected for lacking one.
   *
   * It is *not* derivable from the board: a Hex chain has many possible
   * crossing paths, and Connect Four a winning disc has several runs through
   * it. Only the search that ended the game knows which one it took, so the
   * answer is recorded where it is produced rather than recomputed where it is
   * shown.
   */
  winningLine?: Coordinates[] | null;
  createdAt: number;
  updatedAt: number;
  syncState: SyncState;
  /** Optimistic-concurrency token mirrored to `game_rooms.version`. */
  version: number;
}

export type SyncQueueAction = "CREATE" | "MOVE" | "RESIGN" | "RESET";

export const SYNC_QUEUE_ACTIONS: readonly SyncQueueAction[] = [
  "CREATE",
  "MOVE",
  "RESIGN",
  "RESET",
] as const;

export interface SyncQueueItem {
  id: string;
  gameId: string;
  action: SyncQueueAction;
  payload: MoveRecord | Partial<GameSession>;
  timestamp: number;
  retryCount: number;
  /**
   * Seat that performed the mutation. Required in practice for `RESIGN` and
   * `RESET`, whose payload (`Partial<GameSession>`) carries no actor; for
   * `MOVE` the actor is already recorded on the {@link MoveRecord}.
   */
  actor?: PlayerColor;
}

/**
 * Resolves which seat (if any) the local client holds for a session.
 * `null` means the client is a read-only observer.
 */
export function resolveLocalSeat(
  session: Pick<GameSession, "playerBlackToken" | "playerWhiteToken">,
  token: string | null
): PlayerColor | null {
  if (!token) return null;
  if (session.playerBlackToken === token) return "black";
  if (session.playerWhiteToken === token) return "white";
  return null;
}

/**
 * `true` when the local client may legally dispatch a move right now.
 *
 * Turn ownership only matters when the opponent is somewhere else. An
 * `offline_local` match is hot-seat: both colours are played from the one
 * device, so requiring the local seat to be the one on move would lock the
 * board the moment the first move was made. Realtime sessions keep the strict
 * check, because there the opponent is a different client.
 */
export function canLocalPlayerAct(
  session: Pick<GameSession, "status" | "currentTurn" | "syncState" | "mode">,
  seat: PlayerColor | null
): boolean {
  if (seat === null) return false;
  if (session.syncState === "conflict") return false;
  if (!isPlayableStatus(session.status)) return false;
  if (session.mode === "offline_local") return true;
  return session.currentTurn === seat;
}

/* -------------------------------------------------------------------------- */
/* Board equality (replay verification)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Structural comparison of two arbitrary JSON-shaped values.
 *
 * Used exclusively to answer "did re-executing the move history reproduce the
 * board the server broadcast?". Key order is irrelevant, so a JSONB round trip
 * through Postgres cannot cause a false divergence.
 */
function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!jsonEquals(a[index], b[index])) return false;
    }
    return true;
  }

  if (typeof a === "object") {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bRecord, key)) return false;
      if (!jsonEquals(aRecord[key], bRecord[key])) return false;
    }
    return true;
  }

  return false;
}

/**
 * Compares two board snapshots of the same kind for exact structural equality.
 *
 * Different kinds are never equal, even if their raw structures happened to
 * line up. This is the primitive behind Phase 4.4's integrity gate: a client
 * replays the authoritative move log and compares the result against the
 * broadcast `board_snapshot`; any difference halts play.
 */
export function boardStatesEqual(a: UniversalBoard, b: UniversalBoard): boolean {
  if (a.kind !== b.kind) return false;
  return jsonEquals(a.state, b.state);
}

/* -------------------------------------------------------------------------- */
/* Game catalog                                                               */
/* -------------------------------------------------------------------------- */

export interface GameMetadata {
  readonly kind: GameKind;
  readonly name: string;
  readonly shortName: string;
  readonly gridLabel: string;
  readonly players: 2;
  readonly description: string;
  /** Board dimensions used by the board views; `null` for line-based games. */
  readonly dimensions: Readonly<{ rows: number; columns: number }> | null;
}

/** Display metadata for every {@link GameKind}, in {@link GAME_KINDS} order. */
export const GAME_METADATA: Readonly<Record<GameKind, GameMetadata>> = {
  tictactoe: {
    kind: "tictactoe",
    name: "Tic-Tac-Toe",
    shortName: "TTT",
    gridLabel: "3 x 3",
    players: 2,
    description: "Three in a row on a single-line grid.",
    dimensions: { rows: 3, columns: 3 },
  },
  connect4: {
    kind: "connect4",
    name: "Connect Four",
    shortName: "C4",
    gridLabel: "7 x 6",
    players: 2,
    description: "Drop discs to align four in a row or column.",
    dimensions: { rows: 6, columns: 7 },
  },
  gomoku: {
    kind: "gomoku",
    name: "Gomoku",
    shortName: "GMK",
    gridLabel: "15 x 15",
    players: 2,
    description: "First to five stones in a row on a 15x15 grid.",
    dimensions: { rows: 15, columns: 15 },
  },
  reversi: {
    kind: "reversi",
    name: "Reversi",
    shortName: "RVS",
    gridLabel: "8 x 8",
    players: 2,
    description: "Trap opposing discs between two of your own.",
    dimensions: { rows: 8, columns: 8 },
  },
  checkers: {
    kind: "checkers",
    name: "Checkers",
    shortName: "CHK",
    gridLabel: "8 x 8",
    players: 2,
    description: "Capture by jumping; reach the far rank to be crowned.",
    dimensions: { rows: 8, columns: 8 },
  },
  hex: {
    kind: "hex",
    name: "Hex",
    shortName: "HEX",
    gridLabel: "7 x 7",
    players: 2,
    description: "Connect opposite sides of the hexagonal grid with an unbroken chain.",
    dimensions: { rows: 7, columns: 7 },
  },
};

/**
 * Metadata for a kind this build does not have.
 *
 * The `null` kind is load-bearing rather than a placeholder. Reporting
 * `kind: "hex"` for a row whose `gameKind` is `"chess"` would let any caller
 * that routes on `metadata.kind` quietly hand a legacy session to the Hex
 * engine — a wrong game that loads cleanly, which is far harder to notice than
 * the crash this shape replaces. `null` instead forces the caller to decide
 * what an unknown kind means.
 */
export interface UnknownGameMetadata {
  readonly kind: null;
  readonly name: string;
  readonly shortName: string;
  readonly gridLabel: string;
  readonly players: 2;
  readonly description: string;
  /** Always `null`: an unknown kind has no board geometry to report. */
  readonly dimensions: null;
}

/** Shown when a stored `gameKind` is not merely unknown but unusable as a label. */
const UNKNOWN_KIND_NAME = "Unknown game";

/**
 * Renders a stored kind for display when it is no longer in the catalog.
 *
 * The stored value is echoed back verbatim, truncated, because the most useful
 * thing this can say is *which* retired kind the row still thinks it is — that
 * is the whole diagnostic. The cap is a rendering guard: this string comes from
 * persisted data, and a corrupt row can hold anything, so it must not be able
 * to stretch a header across a phone screen.
 */
function unknownKindName(kind: unknown): string {
  if (typeof kind !== "string") return UNKNOWN_KIND_NAME;
  const trimmed = kind.trim();
  if (trimmed.length === 0) return UNKNOWN_KIND_NAME;
  return trimmed.length > 32 ? `${trimmed.slice(0, 31)}…` : trimmed;
}

/**
 * Display metadata for any kind, known or not.
 *
 * This is total: it accepts `unknown` because the values it is called with
 * reach it from persisted and remote data, where a retired kind is a fact of
 * life rather than a type error. An earlier `GAME_METADATA[kind]` returned
 * `undefined` for such a value, and every caller then read `.name` off it —
 * which is how one stale IndexedDB row took down the whole home page.
 */
export function getGameMetadata(kind: unknown): GameMetadata | UnknownGameMetadata {
  if (isGameKind(kind)) return GAME_METADATA[kind];
  const name = unknownKindName(kind);
  const shortName = name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "??";
  return {
    kind: null,
    name,
    shortName,
    gridLabel: "n/a",
    players: 2,
    description: "This session was saved by a different version of the app and cannot be resumed.",
    dimensions: null,
  };
}
