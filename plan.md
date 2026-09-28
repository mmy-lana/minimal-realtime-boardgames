# Architectural Specification: Minimal Realtime Board Games

## Section 1: Data Schema & Pure TypeScript Interfaces

### 1.1 Pure TypeScript Domain Models

```typescript
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

export interface Coordinates {
  x: number;
  y: number;
}

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

// Hex is the one game of the six with no piece type: a cell holds a colour or
// nothing at all, and the *arrangement* of those colours is the whole position.
// A dedicated piece union would model nothing the cell does not already say.
export type HexCell = PlayerColor | null;
export type HexBoard = HexCell[][];

export type UniversalBoard =
  | { kind: "tictactoe"; state: TicTacToeBoard }
  | { kind: "connect4"; state: Connect4Board }
  | { kind: "gomoku"; state: GomokuBoard }
  | { kind: "reversi"; state: ReversiBoard }
  | { kind: "checkers"; state: CheckersBoard }
  | { kind: "hex"; state: HexBoard };

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
   * The cells that decided the match, or `null` when there is none to point at.
   *
   * Reported by the move that ended the game rather than recomputed from the
   * snapshot afterwards, because the deciding mark is the one a player wants
   * shown and only the move knows which one that was. `null` covers three
   * distinct cases that all mean "nothing to highlight": a game in progress, a
   * result with no line (a resignation, a checkers disc count), and a session
   * that has just been reset — which must forget the line it had, or it lights
   * the winning stones on an empty opening board.
   */
  winningLine?: Coordinates[] | null;
  createdAt: number;
  updatedAt: number;
  syncState: SyncState;
  version: number;
}

export function extractTypedBoard<K extends GameKind>(
  session: GameSession,
  expectedKind: K
): Extract<UniversalBoard, { kind: K }>["state"] {
  if (session.boardSnapshot.kind !== expectedKind) {
    throw new Error(
      `Mismatched board kind: expected ${expectedKind}, received ${session.boardSnapshot.kind}`
    );
  }
  return session.boardSnapshot.state as Extract<UniversalBoard, { kind: K }>["state"];
}

export interface SyncQueueItem {
  id: string;
  gameId: string;
  action: "CREATE" | "MOVE" | "RESIGN" | "RESET";
  payload: MoveRecord | Partial<GameSession>;
  timestamp: number;
  retryCount: number;
}
```

### 1.2 Local Database Schema (Dexie.js / IndexedDB)

```typescript
import Dexie, { type Table } from "dexie";

/**
 * Storage scheme version. Bumped together with a migration — either a `stores`
 * change or an `upgrade` hook to the data — and always written as an explicit
 * literal rather than derived from this constant, because a migration that
 * reads its own version number silently skips the work it was written to do.
 */
export const LOCAL_DB_SCHEMA_VERSION = 2;

export class MinimalBoardGamesDB extends Dexie {
  games!: Table<GameSession, string>;
  syncQueue!: Table<SyncQueueItem, string>;

  constructor() {
    super("minimal_board_games_db");

    // v1 — the original schema, kept verbatim. Dexie needs the full history of
    // version declarations to open a database written by an older build, so
    // this block may never be edited or removed.
    this.version(1).stores({
      games: "id, gameKind, mode, status, updatedAt, syncState",
      syncQueue: "id, gameId, timestamp, retryCount",
    });

    // v2 — same stores, plus a data migration. The `chess` -> `hex` rename left
    // rows behind whose `gameKind` is no longer in the catalog, and those rows
    // were not merely stale: rendering one dereferenced a missing metadata
    // entry and threw, which unmounted the whole page. Pruning at upgrade time
    // removes the cause rather than making every reader survive it.
    this.version(2)
      .stores({
        games: "id, gameKind, mode, status, updatedAt, syncState",
        syncQueue: "id, gameId, timestamp, retryCount",
      })
      .upgrade(async (tx) => {
        const games = tx.table<GameSession, string>("games");
        const syncQueue = tx.table<SyncQueueItem, string>("syncQueue");

        // 1. Drop sessions whose kind this build cannot play. `game?.gameKind`
        //    rather than `game.gameKind`: the declared row type is an
        //    assumption, and a database written by a build that crashed
        //    mid-write can hold something that is not an object at all.
        const staleGameKeys = await games
          .toCollection()
          .filter((game) => !isGameKind(game?.gameKind))
          .primaryKeys();
        if (staleGameKeys.length > 0) await games.bulkDelete(staleGameKeys);

        // 2. Drop queued writes that no longer belong to a live session.
        //    Resolved through `gameId` rather than by inspecting the payload:
        //    a MoveRecord carries no `gameKind` field at all, so testing the
        //    payload would classify every pending move as stale and silently
        //    discard real, unsent, perfectly good moves.
        const liveGameIds = new Set(await games.toCollection().primaryKeys());
        const orphanedQueueKeys = await syncQueue
          .toCollection()
          .filter((item) => !liveGameIds.has(item?.gameId))
          .primaryKeys();
        if (orphanedQueueKeys.length > 0) await syncQueue.bulkDelete(orphanedQueueKeys);
      });
  }
}

export const localDb = new MinimalBoardGamesDB();
```

### 1.3 Remote Supabase Database Schema (PostgreSQL DDL)

```sql
create type game_kind as enum ('tictactoe', 'connect4', 'gomoku', 'reversi', 'checkers', 'hex');
create type match_status as enum ('waiting', 'active', 'draw', 'won_black', 'won_white', 'abandoned');
create type player_color as enum ('black', 'white');

-- MIGRATION NOTE (chess -> hex): the rename is a rename, not a drop-and-add, so
-- a deployment that already has the enum keeps its rows readable.
--   * fresh install -> 'chess' absent              -> undefined_object (no-op)
--   * migrated      -> 'hex' present, no 'chess'   -> undefined_object (no-op)
-- Neither branch is an error, so a single script serves both cases.
do $$
begin
  alter type public.game_kind rename value 'chess' to 'hex';
exception
  when undefined_object then null;
end;
$$;

create table public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  game_kind game_kind not null,
  status match_status not null default 'waiting',
  player_black_token text not null,
  player_white_token text null,
  current_turn player_color not null default 'black',
  turn_number integer not null default 1,
  board_snapshot jsonb not null,
  winner player_color null,
  version integer not null default 1,
  -- Increments on every RESET. Moves are stamped with the epoch that was
  -- current when they were played, so a reset starts a new move log without
  -- destroying the old one. See submit_terminal_update.
  reset_epoch integer not null default 0,
  constraint game_rooms_reset_epoch_non_negative check (reset_epoch >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Row Level Security: updates require matching room version to prevent races
create policy "Allow seated players to update room turn and state"
  on public.game_rooms for update
  using (true)
  with check (true);

create table public.game_moves (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  -- The room reset_epoch in force when this move was played. Ply numbering
  -- restarts at 1 after a reset, so (room_id, epoch, ply) is the identity of a
  -- move; epoch alone is what separates one game from its successors.
  epoch integer not null default 0,
  constraint game_moves_epoch_non_negative check (epoch >= 0),
  ply integer not null,
  player player_color not null,
  from_coord jsonb null,
  to_coord jsonb not null,
  payload text null,
  created_at timestamptz not null default now()
);

alter table public.game_rooms enable row level security;
alter table public.game_moves enable row level security;

-- Full-history replay on load/reconnect reads by (room_id, epoch, ply). This
-- index must carry the epoch: ply numbering restarts at 1 inside every epoch,
-- so a lookup that omitted it would merge two different games' moves and
-- rebuild a board from a log that never happened.
create index if not exists game_moves_room_epoch_ply_idx
  on public.game_moves (room_id, epoch, ply);
create index if not exists game_rooms_kind_status_idx
  on public.game_rooms (game_kind, status);

-- game_moves is an APPEND-ONLY audit trail. A RESET never deletes a row:
-- submit_terminal_update advances game_rooms.reset_epoch instead, which starts a
-- new log and leaves the old one intact as the record of the game that preceded
-- it. Rows still disappear when their room is deleted, via the cascade above.

drop policy if exists "Public anonymous access to insert/update game rooms" on public.game_rooms;
drop policy if exists "Public anonymous access to read game rooms" on public.game_rooms;
drop policy if exists "Public anonymous access to moves" on public.game_moves;
drop policy if exists "Allow seated players to update room turn and state" on public.game_rooms;

-- Read access is public for observers
create policy "Allow reading game rooms"
  on public.game_rooms for select
  using (true);

create policy "Allow inserting game rooms"
  on public.game_rooms for insert
  with check (true);

-- ARCHITECTURAL DECISION: public.game_rooms intentionally has NO client-side UPDATE policy.
-- All mutations must funnel through SECURITY DEFINER RPCs (submit_turn_move, join_room).
-- TRUST MODEL & VALIDATION BOUNDARY:
-- PostgreSQL RPC enforces room lifecycle, seat authorization, valid turn order, and OCC version locking.
-- Board rule validation is client-authoritative: receiving clients re-derive state via engine/rules/*.ts
-- on game_moves Realtime inserts. On initial load or reconnect, full game_moves history is replayed
-- against initial state to verify room snapshot integrity. Divergence sets syncState: 'conflict'.
create or replace function public.submit_turn_move(
  p_room_id uuid,
  p_player_token text,
  p_expected_version integer,
  p_move_id uuid,
  p_ply integer,
  p_player player_color,
  p_from_coord jsonb,
  p_to_coord jsonb,
  p_payload text,
  p_board_snapshot jsonb,
  p_winner player_color,
  p_status match_status
)
returns text
language plpgsql
security definer
as $$
declare
  v_room public.game_rooms%rowtype;
  v_next_turn player_color;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id for update;

  if not found then
    return 'room_not_found';
  end if;

  -- Reject moves on finished, waiting, or abandoned rooms
  if v_room.status != 'active' then
    return 'room_inactive';
  end if;

  if v_room.version != p_expected_version then
    return 'version_conflict';
  end if;

  -- PAYLOAD CEILING. The board snapshot is the one field whose size is not
  -- bounded by the schema, and it is the field a hostile or buggy client
  -- controls. 8192 bytes is roughly 4x the largest real snapshot (the 8x8
  -- Reversi board), so the check never rejects an honest client while still
  -- bounding what a single anonymous RPC call can write.
  if p_board_snapshot is null
    or octet_length(p_board_snapshot::text) > 8192 then
    return 'payload_too_large';
  end if;

  -- KIND INTEGRITY CHECK. A snapshot with no `kind` key, or one whose kind is
  -- JSON null, compares as NULL under `<>`, and a NULL condition is not TRUE —
  -- so `is distinct from` is required here, not a stylistic preference. Without
  -- it a null-kind snapshot walks straight through and the room is left holding
  -- a board no engine can parse.
  if (p_board_snapshot ->> 'kind') is distinct from v_room.game_kind::text then
    return 'invalid_payload_kind';
  end if;

  -- Validate seat identity and turn order with strict null check
  if p_player = 'black' and (v_room.player_black_token is null or v_room.player_black_token != p_player_token or v_room.current_turn != 'black') then
    return 'unauthorized';
  end if;

  if p_player = 'white' and (v_room.player_white_token is null or v_room.player_white_token != p_player_token or v_room.current_turn != 'white') then
    return 'unauthorized';
  end if;

  -- Idempotent move insertion, stamped with the epoch that is current now. The
  -- OCC version check above has already established that no RESET landed since
  -- the client read the room, so v_room.reset_epoch is the epoch this move was
  -- actually played in; a move that raced a reset lands in the old epoch, and
  -- the version conflict that follows sends it back rather than corrupting the
  -- new log.
  insert into public.game_moves (id, room_id, epoch, ply, player, from_coord, to_coord, payload, created_at)
  values (p_move_id, p_room_id, v_room.reset_epoch, p_ply, p_player, p_from_coord, p_to_coord, p_payload, now())
  on conflict (id) do nothing;

  v_next_turn := case when p_player = 'black' then 'white' else 'black' end;

  -- Advance room snapshot atomically
  update public.game_rooms
  set
    board_snapshot = p_board_snapshot,
    current_turn = case when p_status = 'active' then v_next_turn else v_room.current_turn end,
    turn_number = v_room.turn_number + 1,
    status = p_status,
    winner = p_winner,
    version = v_room.version + 1,
    updated_at = now()
  where id = p_room_id;

  return 'success';
end;
$$;

-- Atomic seat reservation for incoming opponents
create or replace function public.join_room(
  p_room_id uuid,
  p_player_token text
)
returns text
language plpgsql
security definer
as $$
declare
  v_room public.game_rooms%rowtype;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id for update;

  if not found then
    return 'room_not_found';
  end if;

  if v_room.player_black_token = p_player_token then
    return 'seated_black';
  end if;

  if v_room.player_white_token = p_player_token then
    return 'seated_white';
  end if;

  if v_room.status != 'waiting' then
    return 'room_closed';
  end if;

  if v_room.player_white_token is null then
    update public.game_rooms
    set
      player_white_token = p_player_token,
      status = 'active',
      version = v_room.version + 1,
      updated_at = now()
    where id = p_room_id;
    return 'seated_white';
  end if;

  return 'room_full';
end;
$$;

-- RPC: submit_terminal_update — resign / reset without a client UPDATE policy.
--
-- ARCHITECTURAL DECISION: the reset advances an epoch rather than deleting the
-- move log. Deleting the rows of the finished game is the obvious way to make a
-- reset look clean, and it destroys the only record of what actually happened in
-- that room. Instead the log stays append-only and the reset moves the room
-- forward: ply numbering restarts at 1 inside the new epoch, clients read only
-- the current epoch, and every earlier move remains queryable forever.
create or replace function public.submit_terminal_update(
  p_room_id uuid,
  p_player_token text,
  p_expected_version integer,
  p_board_snapshot jsonb,
  p_winner player_color,
  p_turn_number integer,
  p_status match_status,
  p_clear_history boolean
)
returns text
language plpgsql
security definer
as $$
declare
  v_room public.game_rooms%rowtype;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id for update;

  if not found then
    return 'room_not_found';
  end if;

  if v_room.version != p_expected_version then
    return 'version_conflict';
  end if;

  -- Same two payload guards as submit_turn_move, for the same reasons: a
  -- bounded snapshot size, and `is distinct from` rather than `<>` so a
  -- missing or JSON-null `kind` is rejected instead of comparing as NULL and
  -- passing.
  if p_board_snapshot is null
    or octet_length(p_board_snapshot::text) > 8192 then
    return 'payload_too_large';
  end if;

  if (p_board_snapshot ->> 'kind') is distinct from v_room.game_kind::text then
    return 'invalid_payload_kind';
  end if;

  -- The update and the epoch bump happen in the SAME statement, so the room is
  -- never observed in a state where its epoch and its moves disagree. A
  -- separate `delete from game_moves` after this would open exactly that window
  -- — and would be the destructive step the epoch exists to avoid.
  update public.game_rooms
  set
    board_snapshot = p_board_snapshot,
    current_turn = 'black',
    turn_number = p_turn_number,
    status = p_status,
    winner = p_winner,
    version = v_room.version + 1,
    reset_epoch = case
      when p_clear_history then v_room.reset_epoch + 1
      else v_room.reset_epoch
    end,
    updated_at = now()
  where id = p_room_id;

  return 'success';
end;
$$;

revoke execute on function public.submit_turn_move from public;
grant execute on function public.submit_turn_move to anon, authenticated;

revoke execute on function public.join_room from public;
grant execute on function public.join_room to anon, authenticated;

revoke execute on function public.submit_terminal_update from public;
grant execute on function public.submit_terminal_update to anon, authenticated;

create policy "Allow reading game moves"
  on public.game_moves for select
  using (true);

alter publication supabase_realtime add table public.game_rooms;
alter publication supabase_realtime add table public.game_moves;
```

---

## Section 2: Component Architecture

### 2.1 Directory Structure

```text
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── [gameKind]/
│   │   ├── page.tsx
│   │   └── [roomId]/
│   │       └── page.tsx
│   └── globals.css
├── components/
│   ├── primitives/
│   │   ├── Button.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   ├── BoardTile.tsx
│   │   ├── SegmentedControl.tsx
│   │   ├── ErrorBoundary.tsx
│   │   └── NetworkIndicator.tsx
│   ├── compound/
│   │   ├── GameShell.tsx
│   │   ├── BoardStage.tsx
│   │   ├── MoveHistoryTimeline.tsx
│   │   ├── PlayerScoreCard.tsx
│   │   └── GameOverDialog.tsx
│   ├── game/
│   │   ├── GameScreen.tsx
│   │   ├── LocalGameRoute.tsx
│   │   └── RealtimeGameRoute.tsx
│   ├── lobby/
│   │   └── GameLobby.tsx
│   └── boards/
│       ├── boardViewTypes.ts
│       ├── TicTacToeBoardView.tsx
│       ├── ConnectFourBoardView.tsx
│       ├── GomokuBoardView.tsx
│       ├── ReversiBoardView.tsx
│       ├── CheckersBoardView.tsx
│       └── HexBoardView.tsx
├── engine/
│   ├── rules/
│   │   ├── tictactoe.ts
│   │   ├── connect4.ts
│   │   ├── gomoku.ts
│   │   ├── reversi.ts
│   │   ├── checkers.ts
│   │   └── hex.ts
│   ├── factory.ts
│   └── types.ts
├── hooks/
│   ├── useGameSession.ts
│   ├── useNetworkStatus.ts
│   ├── useSyncQueue.ts
│   └── useSupabaseRealtime.ts
└── lib/
    ├── db.ts
    ├── realtime.ts
    ├── seatStorage.ts
    ├── sound.ts
    ├── supabase.ts
    ├── sync.ts
    └── utils.ts
```

### 2.2 Component Hierarchy

```text
+-------------------------------------------------------+
| App Layout (Responsive Root Shell)                    |
| +---------------------------------------------------+ |
| | GameShell (Top Nav + Status + NetworkIndicator)   | |
| | +-----------------------+ +---------------------+ | |
| | | Active Board View     | | Side Panel          | | |
| | | (Grid 360px -> 1024px)| | (PlayerCard + Turn) | | |
| | |                       | | (MoveHistoryTimeline| | |
| | | [BoardTile Primitives]| | (Sync / Reset CTAs) | | |
| | +-----------------------+ +---------------------+ | |
| | GameOverDialog (Modal Primitive)                  | |
| +---------------------------------------------------+ |
+-------------------------------------------------------+
```

---

## Section 3: Core Feature Logic & Step-by-Step Algorithms

### 3.1 Rule Engines

#### 3.1.1 Tic-Tac-Toe Engine

**The game is 3-piece vanishing Tic-Tac-Toe, not the nine-move original.** A
player may hold at most `TICTACTOE_MARKS_PER_PLAYER = 3` marks at a time, and
placing a fourth lifts the oldest of the three off the board first. Two
consequences follow, and both are the point of the rule rather than side effects
of it:

- **A draw is mathematically impossible.** Six marks is the most the board can
  hold — three a side — so at least three of the nine cells are always empty and
  the game can never fill. `isDraw` is therefore the constant `false`, not a
  check that happens to come out false. The field stays so the status ladder is
  uniform across all six games rather than special-casing one of them.
- **The vanishing order is the order the marks were placed**, which the flat
  nine-cell snapshot cannot record. Cell 0 is not "the oldest mark" because it
  is the lowest index; it is the oldest only if that player played it first. The
  order comes from the move log, passed in as `playerHistory` — and that is why
  the log, not the snapshot, is what the integrity gate replays.

**The winning-line search is scoped to the mark just played.** `findTicTacToeWinningLine`
takes the index that was filled and only considers the four (or two, at a
corner) lines containing it. Searching all eight lines unconditionally reports a
line that was completed by an *earlier* move and merely still on the board — the
board declares a winner for a column that reads `[empty, O, empty]`. A scope
that narrows the candidates is therefore a correctness requirement, not an
optimisation. `applyTicTacToeMove` then re-verifies `nextBoard[a] === player`
before reporting the line, so a colour that is not the mover's can never be
returned as the winner.

```typescript
import { Coordinates, PlayerColor, TicTacToeBoard } from "../types";

export const TICTACTOE_SIZE = 3;
export const TICTACTOE_CELLS = TICTACTOE_SIZE * TICTACTOE_SIZE;

/** Marks one player may hold at once. Placing a fourth removes the oldest. */
export const TICTACTOE_MARKS_PER_PLAYER = 3;

export const TICTACTOE_WINNING_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function createInitialTicTacToeBoard(): TicTacToeBoard {
  return Array<TicTacToeBoard[number]>(TICTACTOE_CELLS).fill(null);
}

export function validateTicTacToeMove(board: TicTacToeBoard, index: number): boolean {
  return index >= 0 && index < TICTACTOE_CELLS && board[index] === null;
}

/**
 * The marks `player` currently holds, oldest first. A mark is "currently held"
 * if it is still on the board: a player who has played five marks holds the last
 * three, because the first two were removed by the rule.
 */
export function getTicTacToeActiveMarks(
  board: TicTacToeBoard,
  player: PlayerColor,
  playerHistory?: readonly Coordinates[]
): number[] {
  const inOrder: number[] = [];
  const seen = new Set<number>();

  if (playerHistory) {
    for (const coord of playerHistory) {
      const index = tictactoeIndexOf(coord);
      // A log naming a cell twice, or a cell this player no longer holds, cannot
      // contribute a mark: a vanished mark is gone, and playing the same cell
      // twice never happens under a rule that empties the cell first.
      if (seen.has(index) || board[index] !== player) continue;
      seen.add(index);
      inOrder.push(index);
    }
  } else {
    // Deterministic stand-in for a caller that handed us only a board. It
    // agrees with placement order only when the player played in ascending
    // order; every path inside the app supplies the log.
    for (let index = 0; index < TICTACTOE_CELLS; index += 1) {
      if (board[index] === player) inOrder.push(index);
    }
  }

  return inOrder.slice(-TICTACTOE_MARKS_PER_PLAYER);
}

/** The mark that leaves the board when `player` places their next one. */
export function getTicTacToeVanishingIndex(
  board: TicTacToeBoard,
  player: PlayerColor,
  playerHistory?: readonly Coordinates[]
): number | null {
  const active = getTicTacToeActiveMarks(board, player, playerHistory);
  return active.length === TICTACTOE_MARKS_PER_PLAYER ? (active[0] ?? null) : null;
}

/**
 * The winning line containing the last stone, or `null` when there is none.
 * `index` is optional: omitting it searches the whole board (the audit use),
 * supplying it searches only the lines that mark completed — which is what
 * decides a game.
 */
export function findTicTacToeWinningLine(
  board: TicTacToeBoard,
  index?: number
): readonly [number, number, number] | null {
  for (const line of TICTACTOE_WINNING_LINES) {
    if (index !== undefined && !line.includes(index)) continue;
    const [a, b, c] = line;
    const cell = board[a];
    if (cell !== null && cell === board[b] && cell === board[c]) return line;
  }
  return null;
}

export function applyTicTacToeMove(
  board: TicTacToeBoard,
  index: number,
  player: PlayerColor,
  playerHistory?: readonly Coordinates[]
): {
  nextBoard: TicTacToeBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
  vanishedIndex: number | null;
  winningLine: Coordinates[] | null;
} {
  if (!validateTicTacToeMove(board, index)) {
    throw new Error(`Invalid tic-tac-toe move: index ${index} is out of range or occupied`);
  }

  const nextBoard = [...board];
  // Room first, then the mark. Reversing the two would let a player refill the
  // cell their own vanishing mark just vacated and hold four at once.
  const vanishedIndex = getTicTacToeVanishingIndex(board, player, playerHistory);
  if (vanishedIndex !== null) nextBoard[vanishedIndex] = null;
  nextBoard[index] = player;

  // Only the lines through the mark just played are candidates.
  const winningLineMatch = findTicTacToeWinningLine(nextBoard, index);

  // Cell indices internally, board coordinates outside. Every consumer of a
  // result — the session, the views, the move log — speaks in coordinates, and
  // a nine-cell array index is a tic-tac-toe detail that would leak into all of
  // them if this field kept it.
  let winningLine: Coordinates[] | null = null;
  if (winningLineMatch) {
    const [a] = winningLineMatch;
    // Belt and braces: the line must be the MOVER's. A line belonging to the
    // opponent is never a win, whatever the search returned.
    if (nextBoard[a] === player) {
      winningLine = winningLineMatch.map(tictactoeCoordOf);
    }
  }

  return {
    nextBoard,
    winner: winningLine ? player : null,
    isDraw: false, // Mathematically impossible: three marks a side, nine cells.
    vanishedIndex,
    winningLine,
  };
}
```

#### 3.1.2 Connect Four Engine
```typescript
import { Connect4Board, PlayerColor } from "../types";

export const CONNECT4_ROWS = 6;
export const CONNECT4_COLS = 7;

export function createInitialConnect4Board(): Connect4Board {
  return Array.from({ length: CONNECT4_ROWS }, () => Array(CONNECT4_COLS).fill(null));
}

export function getConnect4LowestAvailableRow(board: Connect4Board, col: number): number {
  for (let row = CONNECT4_ROWS - 1; row >= 0; row--) {
    if (board[row][col] === null) return row;
  }
  return -1;
}

export function applyConnect4Move(
  board: Connect4Board,
  col: number,
  player: PlayerColor
): { nextBoard: Connect4Board; placedRow: number; winner: PlayerColor | null; isDraw: boolean } {
  const targetRow = getConnect4LowestAvailableRow(board, col);
  if (targetRow === -1) {
    throw new Error("Target column is fully occupied");
  }

  const nextBoard = board.map((r) => [...r]);
  nextBoard[targetRow][col] = player;

  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of directions) {
    let count = 1;

    for (let s = 1; s < 4; s++) {
      const nr = targetRow + dr * s;
      const nc = col + dc * s;
      if (nr >= 0 && nr < CONNECT4_ROWS && nc >= 0 && nc < CONNECT4_COLS && nextBoard[nr][nc] === player) {
        count++;
      } else {
        break;
      }
    }

    for (let s = 1; s < 4; s++) {
      const nr = targetRow - dr * s;
      const nc = col - dc * s;
      if (nr >= 0 && nr < CONNECT4_ROWS && nc >= 0 && nc < CONNECT4_COLS && nextBoard[nr][nc] === player) {
        count++;
      } else {
        break;
      }
    }

    if (count >= 4) {
      return { nextBoard, placedRow: targetRow, winner: player, isDraw: false };
    }
  }

  const isDraw = nextBoard[0].every((cell) => cell !== null);
  return { nextBoard, placedRow: targetRow, winner: null, isDraw };
}
```

#### 3.1.3 Gomoku Engine
```typescript
import { Coordinates, GomokuBoard, PlayerColor } from "../types";

export const GOMOKU_SIZE = 15;

export function createInitialGomokuBoard(): GomokuBoard {
  return Array.from({ length: GOMOKU_SIZE }, () => Array(GOMOKU_SIZE).fill(null));
}

export function applyGomokuMove(
  board: GomokuBoard,
  coord: Coordinates,
  player: PlayerColor
): { nextBoard: GomokuBoard; winner: PlayerColor | null; isDraw: boolean } {
  if (board[coord.y][coord.x] !== null) {
    throw new Error("Square is already occupied");
  }

  const nextBoard = board.map((r) => [...r]);
  nextBoard[coord.y][coord.x] = player;

  const vectors = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dy, dx] of vectors) {
    let streak = 1;
    for (let step = 1; step < 5; step++) {
      const ny = coord.y + dy * step;
      const nx = coord.x + dx * step;
      if (ny >= 0 && ny < GOMOKU_SIZE && nx >= 0 && nx < GOMOKU_SIZE && nextBoard[ny][nx] === player) {
        streak++;
      } else {
        break;
      }
    }
    for (let step = 1; step < 5; step++) {
      const ny = coord.y - dy * step;
      const nx = coord.x - dx * step;
      if (ny >= 0 && ny < GOMOKU_SIZE && nx >= 0 && nx < GOMOKU_SIZE && nextBoard[ny][nx] === player) {
        streak++;
      } else {
        break;
      }
    }
    if (streak >= 5) {
      return { nextBoard, winner: player, isDraw: false };
    }
  }

  const isDraw = nextBoard.every((row) => row.every((c) => c !== null));
  return { nextBoard, winner: null, isDraw };
}
```

#### 3.1.4 Reversi Engine
```typescript
import { Coordinates, PlayerColor, ReversiBoard } from "../types";

export const REVERSI_SIZE = 8;

export function createInitialReversiBoard(): ReversiBoard {
  const board: ReversiBoard = Array.from({ length: REVERSI_SIZE }, () =>
    Array(REVERSI_SIZE).fill(null)
  );
  board[3][3] = "white";
  board[3][4] = "black";
  board[4][3] = "black";
  board[4][4] = "white";
  return board;
}

export function getFlipsForMove(
  board: ReversiBoard,
  coord: Coordinates,
  player: PlayerColor
): Coordinates[] {
  if (board[coord.y][coord.x] !== null) return [];
  const opponent: PlayerColor = player === "black" ? "white" : "black";
  const flips: Coordinates[] = [];
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  for (const [dy, dx] of directions) {
    const candidateFlips: Coordinates[] = [];
    let curY = coord.y + dy;
    let curX = coord.x + dx;

    while (curY >= 0 && curY < REVERSI_SIZE && curX >= 0 && curX < REVERSI_SIZE) {
      if (board[curY][curX] === opponent) {
        candidateFlips.push({ y: curY, x: curX });
        curY += dy;
        curX += dx;
      } else if (board[curY][curX] === player) {
        if (candidateFlips.length > 0) {
          flips.push(...candidateFlips);
        }
        break;
      } else {
        break;
      }
    }
  }
  return flips;
}

export function getValidReversiMoves(board: ReversiBoard, player: PlayerColor): Coordinates[] {
  const validMoves: Coordinates[] = [];
  for (let y = 0; y < REVERSI_SIZE; y++) {
    for (let x = 0; x < REVERSI_SIZE; x++) {
      if (getFlipsForMove(board, { x, y }, player).length > 0) {
        validMoves.push({ x, y });
      }
    }
  }
  return validMoves;
}

export function applyReversiMove(
  board: ReversiBoard,
  coord: Coordinates,
  player: PlayerColor
): {
  nextBoard: ReversiBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
  nextTurnHasValidMoves: boolean;
} {
  const flips = getFlipsForMove(board, coord, player);
  if (flips.length === 0) {
    throw new Error("Invalid move: no pieces flipped");
  }

  const nextBoard = board.map((r) => [...r]);
  nextBoard[coord.y][coord.x] = player;
  for (const f of flips) {
    nextBoard[f.y][f.x] = player;
  }

  const opponent: PlayerColor = player === "black" ? "white" : "black";
  const opponentMoves = getValidReversiMoves(nextBoard, opponent);
  const playerMoves = getValidReversiMoves(nextBoard, player);

  let winner: PlayerColor | null = null;
  let isDraw = false;

  if (opponentMoves.length === 0 && playerMoves.length === 0) {
    let blackCount = 0;
    let whiteCount = 0;
    for (let r = 0; r < REVERSI_SIZE; r++) {
      for (let c = 0; c < REVERSI_SIZE; c++) {
        if (nextBoard[r][c] === "black") blackCount++;
        if (nextBoard[r][c] === "white") whiteCount++;
      }
    }
    if (blackCount > whiteCount) winner = "black";
    else if (whiteCount > blackCount) winner = "white";
    else isDraw = true;
  }

  return {
    nextBoard,
    winner,
    isDraw,
    nextTurnHasValidMoves: opponentMoves.length > 0,
  };
}
```

#### 3.1.5 Checkers Engine
```typescript
import { CheckersBoard, CheckersCell, Coordinates, PlayerColor } from "../types";

export const CHECKERS_SIZE = 8;

export function createInitialCheckersBoard(): CheckersBoard {
  const board: CheckersBoard = Array.from({ length: CHECKERS_SIZE }, () =>
    Array(CHECKERS_SIZE).fill(null)
  );
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < CHECKERS_SIZE; x++) {
      if ((y + x) % 2 === 1) {
        board[y][x] = { color: "black", type: "pawn" };
      }
    }
  }
  for (let y = 5; y < CHECKERS_SIZE; y++) {
    for (let x = 0; x < CHECKERS_SIZE; x++) {
      if ((y + x) % 2 === 1) {
        board[y][x] = { color: "white", type: "pawn" };
      }
    }
  }
  return board;
}

export interface CheckersMoveOption {
  from: Coordinates;
  to: Coordinates;
  jumpedCoord?: Coordinates;
}

export function getCheckersLegalMoves(board: CheckersBoard, player: PlayerColor): CheckersMoveOption[] {
  const jumpMoves: CheckersMoveOption[] = [];
  const simpleMoves: CheckersMoveOption[] = [];
  const forwardDelta = player === "black" ? 1 : -1;

  for (let y = 0; y < CHECKERS_SIZE; y++) {
    for (let x = 0; x < CHECKERS_SIZE; x++) {
      const piece = board[y][x];
      if (!piece || piece.color !== player) continue;

      const directions: number[][] = [];
      if (piece.type === "king") {
        directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
      } else {
        directions.push([forwardDelta, -1], [forwardDelta, 1]);
      }

      for (const [dy, dx] of directions) {
        const ny = y + dy;
        const nx = x + dx;

        if (ny >= 0 && ny < CHECKERS_SIZE && nx >= 0 && nx < CHECKERS_SIZE) {
          if (board[ny][nx] === null) {
            simpleMoves.push({ from: { x, y }, to: { x: nx, y: ny } });
          } else if (board[ny][nx]?.color !== player) {
            const jny = ny + dy;
            const jnx = nx + dx;
            if (
              jny >= 0 &&
              jny < CHECKERS_SIZE &&
              jnx >= 0 &&
              jnx < CHECKERS_SIZE &&
              board[jny][jnx] === null
            ) {
              jumpMoves.push({
                from: { x, y },
                to: { x: jnx, y: jny },
                jumpedCoord: { x: nx, y: ny },
              });
            }
          }
        }
      }
    }
  }
  return jumpMoves.length > 0 ? jumpMoves : simpleMoves;
}

export function applyCheckersMove(
  board: CheckersBoard,
  move: CheckersMoveOption,
  player: PlayerColor
): {
  nextBoard: CheckersBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
  canJumpAgain: boolean;
} {
  const nextBoard = board.map((r) => [...r]);
  const activePiece = nextBoard[move.from.y][move.from.x];

  if (!activePiece || activePiece.color !== player) {
    throw new Error("Invalid checkers move: piece selection error");
  }

  nextBoard[move.from.y][move.from.x] = null;

  // Whether this move CROWNS a man, as distinct from a piece that was already a
  // king. The distinction decides the rest of the turn: a king that lands on the
  // king row has not changed, so its capture chain continues, while a man that
  // arrives there has just been promoted and the move is over.
  const wasKing = activePiece.type === "king";
  let isCrowned = wasKing;
  if (player === "black" && move.to.y === CHECKERS_SIZE - 1) isCrowned = true;
  if (player === "white" && move.to.y === 0) isCrowned = true;
  const newlyCrowned = isCrowned && !wasKing;

  nextBoard[move.to.y][move.to.x] = {
    color: player,
    type: isCrowned ? "king" : "pawn",
  };

  // The captured piece leaves the board with the move, not after it: the jump
  // removes it, and leaving it on while the chain continues would let the same
  // victim be jumped twice in one turn.
  if (move.jumpedCoord) {
    nextBoard[move.jumpedCoord.y][move.jumpedCoord.x] = null;
  }

  const opponent: PlayerColor = player === "black" ? "white" : "black";
  const opponentMoves = getCheckersLegalMoves(nextBoard, opponent);

  let winner: PlayerColor | null = null;
  if (opponentMoves.length === 0) {
    winner = player;
  }

  // Whether this capture is the whole move or only its first leg. The question
  // can only be asked of the piece that just moved, so the search is restricted
  // to jumps that start on the landing square: any other jumping piece on the
  // board is irrelevant, because the forced-capture rule binds the whole turn to
  // the piece already in hand, not to a fresh choice of victim.
  //
  // CROWNING ENDS THE TURN. A man that crowns on a jump is the one case where a
  // legal continuation is not a continuation. It has just become a king, and as a
  // king it can of course jump on — but the turn ends here, because tournament
  // draughts treats the crown as the end of the move rather than as a promotion
  // in the middle of one. The bug this prevents is silent and looks like a gift:
  // the chain carried on with the new king, taking one more piece than the rules
  // allow, and the opponent was never given the turn that should have followed.
  const furtherJumps =
    move.jumpedCoord && !newlyCrowned
      ? getCheckersMovesFrom(nextBoard, move.to, player).filter(
          (option) => option.jumpedCoord !== undefined
        )
      : [];

  return { nextBoard, winner, isDraw: false, canJumpAgain: furtherJumps.length > 0 };
}
```

**The session layer turns `canJumpAgain` into a retained selection.**
`factory.ts` keeps the landing square as the new selection — and therefore keeps
the turn with the mover — only when `canJumpAgain` is true *and* the game was not
just won. A crowned jump reports `canJumpAgain: false`, so the selection is
cleared, the turn passes, and the opponent plays from a position that already
accounts for every piece the rules allowed the player to take.

#### 3.1.6 Hex Engine (Deterministic Micro-Engine)

**Hex is the one game of the six whose outcome is decided by a topology fact
rather than by a rule.** Two players place a stone of their own colour on an
empty cell in turn; the first to hold an unbroken chain of their stones between
their two opposite sides wins. Black connects the top row to the bottom row;
White connects the left column to the right column. Black moves first.

**The board is a rhombus, not a rectangle, and the geometry has to be stated
once and only once.** Getting it wrong does not produce a crash — it produces a
board where the diagonals do not connect and a chain that *looks* broken to the
player is judged joined by the engine. The convention used here is the standard
one: rows are `y = 0..6`, columns are `x = 0..6`, and row `y` is shifted half a
cell to the right relative to row `y - 1`. A cell therefore has six neighbours and
only six.

**The start edge and the goal edge must be separate predicates.** A flood fill
seeded from a player's *start* edge immediately re-encounters that same edge, so
a predicate answering "is this cell on one of my two edges?" reports a win for
the single stone the search started from — and for every position that touches
its own start edge, which is every position. A cell counts as a win only when it
lies on the edge at the *other* end of the span.

**There is no draw.** Hex is completely solved (Berlekamp, Conway and Guy, 1990),
and more practically the exhausted position is unreachable for a 49-cell board
with two players alternating: the board is full only if all 49 cells are taken,
and at that point a chain of both colours crossing the board is a contradiction
rather than a tie. The engine reports `isDraw: false` unconditionally, so a Hex
room can never end in `status: "draw"` and the UI never has to describe an
outcome that cannot occur.

```typescript
import { Coordinates, HexBoard, HexCell, PlayerColor } from "../types";
import { getBoardCell } from "../types";

/** Hex is played on a 7x7 rhombus — the size small enough to read on a phone. */
export const HEX_SIZE = 7;

/**
 * The six neighbours of a cell, as `(dy, dx)` offsets. Two axes run through the
 * board — "along a row" (dy = 0) and "along a column" (dy = ±1) — and because
 * each row is offset half a cell, the third axis (dy = ±1, dx = ∓1) is also
 * adjacent. Stating all six in one place is the point: a win computed over four
 * directions while the board is *drawn* with six is a bug a player sees and an
 * engine cannot.
 */
export const HEX_DIRECTIONS: readonly (readonly [number, number])[] = [
  [-1, 0],   // up
  [1, 0],    // down
  [0, -1],   // left
  [0, 1],    // right
  [-1, 1],   // up-right
  [1, -1],   // down-left
] as const;

export function createInitialHexBoard(): HexBoard {
  return Array.from({ length: HEX_SIZE }, () =>
    Array<HexCell>(HEX_SIZE).fill(null)
  );
}

function isOnBoard(x: number, y: number): boolean {
  return y >= 0 && y < HEX_SIZE && x >= 0 && x < HEX_SIZE;
}

/**
 * The two edges each colour has to span, as two separate predicates — see the
 * note above. Black spans the horizontal edges, White the vertical ones; they
 * are transposes of each other under this rhombus, so keeping them in one place
 * is what stops Black and White being mixed up in a way that only shows in play.
 */
function edgesForPlayer(player: PlayerColor): {
  onStartEdge: (x: number, y: number) => boolean;
  onGoalEdge: (x: number, y: number) => boolean;
} {
  if (player === "black") {
    return { onStartEdge: (_x, y) => y === 0, onGoalEdge: (_x, y) => y === HEX_SIZE - 1 };
  }
  return { onStartEdge: (x) => x === 0, onGoalEdge: (x) => x === HEX_SIZE - 1 };
}

/**
 * The chain `player` holds between their two sides, or `null` when there is
 * none.
 *
 * A breadth-first search seeded ONLY from cells strictly on the start edge,
 * traversing only same-coloured stones through `HEX_DIRECTIONS`, and accepting
 * only a cell strictly on the goal edge. The search remembers which cell it
 * reached each one *from*, so the winning chain is handed back as a path: a
 * boolean cannot, and re-deriving the path in a view would mean a second flood
 * fill over a geometry that is only correct once, in this file.
 *
 * A chain of four stones ending at y = 3 therefore returns `null` — it is a real
 * chain, it simply has not reached the far edge.
 */
export function findHexWinningPath(board: HexBoard, player: PlayerColor): Coordinates[] | null {
  const { onStartEdge, onGoalEdge } = edgesForPlayer(player);
  const queue: Coordinates[] = [];
  // Keyed by coordinate, valued by the cell the search arrived from. A start-edge
  // cell has no parent — it is a root, not a cell something reached.
  const parent: Map<string, Coordinates | null> = new Map();

  for (let y = 0; y < HEX_SIZE; y += 1) {
    for (let x = 0; x < HEX_SIZE; x += 1) {
      if (getBoardCell(board, x, y) !== player) continue;
      if (!onStartEdge(x, y)) continue;
      queue.push({ x, y });
      parent.set(`${x},${y}`, null);
    }
  }

  if (queue.length === 0) return null;

  while (queue.length > 0) {
    const current = queue.shift() as Coordinates;

    // Tested on dequeue against the *far* edge, so a chain that only ever
    // wanders back along the start edge never satisfies it.
    if (onGoalEdge(current.x, current.y)) {
      // Unwound from the far edge, so the path comes out goal-first; reversed,
      // because the direction a player reads a chain in is start edge to goal
      // edge.
      const path: Coordinates[] = [];
      let cell: Coordinates | null = current;
      while (cell !== null) {
        path.push(cell);
        cell = parent.get(`${cell.x},${cell.y}`) ?? null;
      }
      return path.reverse();
    }

    for (const [dy, dx] of HEX_DIRECTIONS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isOnBoard(nx, ny)) continue;
      if (parent.has(`${nx},${ny}`)) continue;
      if (getBoardCell(board, nx, ny) !== player) continue;
      parent.set(`${nx},${ny}`, current);
      queue.push({ x: nx, y: ny });
    }
  }

  return null;
}

/**
 * `true` when `player` holds an unbroken chain between their two sides.
 * Deliberately not a second implementation of `findHexWinningPath`: two searches
 * over this geometry could disagree, and the one that gets to decide a game is
 * the one nobody reads.
 */
export function checkHexWin(board: HexBoard, player: PlayerColor): boolean {
  return findHexWinningPath(board, player) !== null;
}

/** Every empty cell, in row-major order. A Hex move has no origin square. */
export function getHexLegalMoves(board: HexBoard, _player?: PlayerColor): Coordinates[] {
  const moves: Coordinates[] = [];
  for (let y = 0; y < HEX_SIZE; y += 1) {
    for (let x = 0; x < HEX_SIZE; x += 1) {
      if (getBoardCell(board, x, y) === null) moves.push({ x, y });
    }
  }
  return moves;
}

/**
 * Places a stone and resolves the game.
 *
 * The coordinate is validated here rather than trusted: `applyMove` is reachable
 * from a reconstructed move log, and a log is data. An occupied cell or an
 * off-board coordinate throws rather than silently overwriting a stone, because
 * the alternative — a null winner on the current board — would let a corrupt log
 * look like a legal game that is merely still in progress.
 *
 * The board is copied before writing: the same object is held in React state,
 * serialised into the IndexedDB snapshot, and compared by the replay integrator
 * on the other client. An in-place write would make the local view appear to
 * have moved before the move was accepted.
 */
export function applyHexMove(
  board: HexBoard,
  coord: Coordinates,
  player: PlayerColor
): {
  nextBoard: HexBoard;
  winner: PlayerColor | null;
  isDraw: boolean;
  winningLine: Coordinates[] | null;
} {
  if (!isOnBoard(coord.x, coord.y)) {
    throw new RangeError(
      `Hex move out of bounds: (${coord.x}, ${coord.y}) is not on a ${HEX_SIZE}x${HEX_SIZE} board`
    );
  }
  if (getBoardCell(board, coord.x, coord.y) !== null) {
    throw new Error(
      `Hex cell (${coord.x}, ${coord.y}) is already occupied by ${String(getBoardCell(board, coord.x, coord.y))}`
    );
  }

  const nextBoard = board.map((row) => row.slice());
  nextBoard[coord.y][coord.x] = player;

  const winningPath = findHexWinningPath(nextBoard, player);
  return {
    nextBoard,
    winner: winningPath ? player : null,
    isDraw: false,
    winningLine: winningPath,
  };
}

/** How many stones each side has on the board. Used by the score cards. */
export function countHexStones(board: HexBoard): Record<PlayerColor, number> {
  const counts: Record<PlayerColor, number> = { black: 0, white: 0 };
  for (let y = 0; y < HEX_SIZE; y += 1) {
    for (let x = 0; x < HEX_SIZE; x += 1) {
      const cell = getBoardCell(board, x, y);
      if (cell !== null) counts[cell] += 1;
    }
  }
  return counts;
}
```

### 3.2 Offline-First Sync & Mutation Queue

```typescript
import { createClient } from "@supabase/supabase-js";
import { localDb } from "./db";
import { GameSession, MoveRecord, SyncQueueItem } from "../types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function dispatchMoveMutation(
  session: GameSession,
  mutationPayload: SyncQueueItem
): Promise<void> {
  await localDb.transaction("rw", localDb.games, localDb.syncQueue, async () => {
    await localDb.games.put(session);
    if (session.mode === "online_realtime") {
      await localDb.syncQueue.put(mutationPayload);
    }
  });

  if (typeof window !== "undefined" && navigator.onLine && session.mode === "online_realtime") {
    await flushSyncQueue();
  }
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes("fetch")) return true;
  if (typeof window !== "undefined" && !navigator.onLine) return true;
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: number }).status;
    return status === 0 || status === 502 || status === 503 || status === 504;
  }
  return false;
}

export async function flushSyncQueue(): Promise<void> {
  const pendingItems = await localDb.syncQueue.orderBy("timestamp").toArray();
  if (pendingItems.length === 0) return;

  for (const item of pendingItems) {
    try {
      const session = await localDb.games.get(item.gameId);
      if (!session) {
        await localDb.syncQueue.delete(item.id);
        continue;
      }

      switch (item.action) {
        case "CREATE": {
          const { error } = await supabase.from("game_rooms").upsert(
            {
              id: session.id,
              game_kind: session.gameKind,
              status: session.status,
              player_black_token: session.playerBlackToken,
              player_white_token: session.playerWhiteToken,
              current_turn: session.currentTurn,
              turn_number: session.turnNumber,
              board_snapshot: session.boardSnapshot,
              winner: session.winner,
              version: session.version,
              created_at: new Date(session.createdAt).toISOString(),
              updated_at: new Date(session.updatedAt).toISOString(),
            },
            { onConflict: "id", ignoreDuplicates: true }
          );
          if (error) throw error;
          break;
        }

        case "MOVE": {
          const moveData = item.payload as MoveRecord;
          const playerToken =
            moveData.player === "black" ? session.playerBlackToken : session.playerWhiteToken;

          if (!playerToken) {
            throw new Error("Missing seated player token for authorized move execution");
          }

          const { data: rpcResult, error: rpcError } = await supabase.rpc("submit_turn_move", {
            p_room_id: session.id,
            p_player_token: playerToken,
            p_expected_version: session.version,
            p_move_id: moveData.id,
            p_ply: moveData.ply,
            p_player: moveData.player,
            p_from_coord: moveData.from ?? null,
            p_to_coord: moveData.to,
            p_payload: moveData.payload ?? null,
            p_board_snapshot: session.boardSnapshot,
            p_winner: session.winner,
            p_status: session.status,
          });

          if (rpcError) throw rpcError;

          if (rpcResult !== "success") {
            await localDb.games.update(item.gameId, { syncState: "conflict" });

            const isTransientConflict = rpcResult === "version_conflict";
            if (isTransientConflict && item.retryCount < 3) {
              await localDb.syncQueue.update(item.id, { retryCount: item.retryCount + 1 });
            } else {
              // Terminal failure (unauthorized, room closed/not found, or retry exhausted): drop from queue
              await localDb.syncQueue.delete(item.id);
            }
            continue;
          }

          await localDb.games.update(item.gameId, {
            syncState: "synced",
            version: session.version + 1,
          });
          break;
        }

        case "RESIGN":
        case "RESET": {
          const { data: updatedRoom, error: updateError } = await supabase
            .from("game_rooms")
            .update({
              board_snapshot: session.boardSnapshot,
              status: session.status,
              winner: session.winner,
              current_turn: session.currentTurn,
              version: session.version + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", item.gameId)
            .eq("version", session.version)
            .select("version");

          if (updateError) throw updateError;

          if (!updatedRoom || updatedRoom.length === 0) {
            await localDb.games.update(item.gameId, { syncState: "conflict" });
            await localDb.syncQueue.update(item.id, { retryCount: item.retryCount + 1 });
            continue;
          }

          await localDb.games.update(item.gameId, {
            syncState: "synced",
            version: session.version + 1,
          });
          break;
        }
      }

      await localDb.syncQueue.delete(item.id);
    } catch (error: unknown) {
      if (isNetworkError(error)) {
        // Network outages are transient: preserve queue item and retryCount intact until connectivity restores
        break;
      }

      const nextRetryCount = item.retryCount + 1;
      if (nextRetryCount >= 3) {
        await localDb.syncQueue.delete(item.id);
        await localDb.games.update(item.gameId, { syncState: "conflict" });
      } else {
        await localDb.syncQueue.update(item.id, { retryCount: nextRetryCount });
      }

      continue;
    }
  }
}
```

---

## Section 4: 5-Phase Sequential Queue

### Phase 1: Types, Storage/API Client Config, and Base Utilities
1. Write full TypeScript types for board states, moves, session lifecycle, and network state in `src/engine/types.ts`. Include `extractTypedBoard` and safe coordinate/cell extraction utilities `getBoardCell`.
2. Configure Dexie.js database schema in `src/lib/db.ts` and install `dexie-react-hooks` (`useLiveQuery`) for reactive components.
3. Configure Supabase client in `src/lib/supabase.ts` with mandatory runtime checks on `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Implement `dispatchMoveMutation`, `flushSyncQueue`, and `isNetworkError` in `src/lib/sync.ts`.

### Phase 2: Design Foundation & Atomic UI Primitives
1. Configure Tailwind CSS v4 tokens directly in `src/app/globals.css` using the `@theme` directive (e.g. `--color-board-dark: #1A1A1A;`, `--color-board-light: #FFFFFF;`, hairline borders `#E5E5E5`) under `@import "tailwindcss";` without v3 config files.
2. Build `BoardTile.tsx` supporting standard dimensions, touch-hold suppression, and focus rings.
3. Build `Button.tsx` and `SegmentedControl.tsx` for zero-clutter switches (Local vs Realtime).
4. Implement `NetworkIndicator.tsx` using `navigator.onLine` and realtime socket connection states.
5. Create accessible modal wrapper `Modal.tsx` for match resolution states without external icon libraries.

### Phase 3: Compound Molecules & Feature Components
1. Construct `GameShell.tsx` responsive layout framework. Explicitly enforce viewport boundaries: stack elements vertically on mobile (`flex-col` on `< 768px`) with the side panel collapsed underneath the active board or inside a bottom drawer, switching to a side-by-side split (`flex-row`) only at `>= 768px`.
2. Build `TicTacToeBoardView.tsx` with high-density lines and tactile SVG markers.
3. Build `ConnectFourBoardView.tsx` with column drop targets and mobile tap zones.
4. Build `GomokuBoardView.tsx` handling 15x15 intersection coordinates with touch tolerance.
5. Build `ReversiBoardView.tsx` featuring visual dots for legal disc placement indicators.
6. Build `CheckersBoardView.tsx` with a two-tone cell grid and piece markers, and `HexBoardView.tsx` as a rhombus: seven rows of seven, each row shifted half a cell right of the one above. The board is 10 cell-widths across and 7 tall, so every row is 70% of the board width and row `y` starts at `y * 5%` — all fractions of the board, never pixels, so the rhombus survives any resize. **All 49 cells carry explicit boundary styling at all times** (`rounded-full border border-neutral-300 bg-neutral-100/80`): an empty Hex cell with a transparent background and no border is invisible against the canvas, which hides 40+ legal moves at a stroke. The four goal rails are captioned rather than drawn bare, because a rail on its own says *which* edges and not *whose* — Black's top and bottom, White's left and right, each with arrows pointing inwards at the edge its own caption names.
7. Construct `MoveHistoryTimeline.tsx` displaying plies in algebraic or coordinate notation.

### Phase 4: Domain Logic, Reactive State, and Specialized APIs
1. Implement rule engines: `tictactoe.ts`, `connect4.ts`, `gomoku.ts`, `reversi.ts`, `checkers.ts`, and `hex.ts`.
2. Build custom hook `useGameSession.ts` exposing unified dispatcher `makeMove(from?, to)`.
3. Build `useOfflineSync.ts` managing `Dexie` write-through mutations and retry loops.
4. Build `useSupabaseRealtime.ts` subscribing to `game_moves` CDC inserts. On move arrival, replays coordinates through the corresponding rule engine (`engine/rules/*.ts`) against the prior verified board (for Checkers, re-derives `jumpedCoord: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }` when `Math.abs(to.y - from.y) === 2`). If the locally recomputed board differs from the broadcast `board_snapshot`, sets `syncState: 'conflict'`, halts play, and renders an invalid-state warning modal via `GameOverDialog`. On initial load or reconnect, sequentially replays all historical moves from `game_moves` in-memory (< 250 moves per complete session, executes synchronously in < 2ms) to verify snapshot integrity before mounting board interaction.
5. Implement sound trigger utility using the native Web Audio API (zero audio file dependencies, pure synth pulses).

### Phase 5: Complete Page/Screen Assembly & Responsive Shell
1. Assemble route `/` with 6-game selector matrix and local vs realtime mode toggles.
2. Assemble parameterized game routes `/[gameKind]` with auto-instantiation in Dexie.
3. Assemble multiplayer routes `/[gameKind]/[roomId]` connecting local state with Supabase Realtime channel broadcast.
4. Validate responsive layouts across screen viewports:
   - 360px (compact mobile): Side panel stacks directly below active board (`flex-col` layout below `md: 768px`). Gomoku 15x15 visual grid cells shrink to ~22px while touch targets are decoupled using an invisible tap intercept overlay. `MoveHistoryTimeline` constrained with `overflow-y-auto max-h-36`.
   - 390px / 430px (modern mobile): Full-width constrained square board (`max-w-[calc(100vw-2rem)]`), history accordion collapsible.
   - 768px (tablet): Two-column layout with inline history drawer, vertical scroll max-height 480px, side-by-side player indicators.
   - 1024px+ (desktop): Centered fixed board canvas with persistent side rail.
5. Build `BoardStage.tsx` as the rigid canvas every board renders inside. Two boxes, not one, because the guarantee needs to be structural rather than a promise each of the six views has to keep: the **frame** is a viewport-derived box with `overflow-hidden` that cannot respond to its contents, and the **canvas** inside it is a plain centring flex box. One entry per kind reserves the space *before* the board is measured, so the ratio a board draws itself at and the ratio the space was reserved for cannot drift apart:

   ```typescript
   const STAGE_ASPECT_RATIO: Readonly<Record<GameKind, string>> = {
     tictactoe: "1 / 1",
     connect4: "7 / 6",   // 7 cells wide by 6 tall
     gomoku: "1 / 1",
     reversi: "1 / 1",
     checkers: "1 / 1",
     hex: "10 / 7",       // the rhombus: 7 cells + 6 half-cell offsets
   };
   ```

   Hex is the ratio that is easy to get wrong. A square frame around a 10:7 rhombus wastes three tenths of the height on every screen — on a 360x640 phone that is the difference between a board that fits and one that pushes the score cards off — and a frame *tighter* than the playfield clips the bottom goal rail instead.
6. The match review banner is **non-blocking**. A finished board is the one board state a player most wants to look at, so the result is presented as a dismissible banner plus an explicit winner card naming the seat and the colour — never as a modal that takes the board away. The board keeps its winning-line highlight while the banner is up, because the highlight and the review answer the same question from two sides and a player who is looking at the board wants both.
7. Test offline disconnection, Docker Supabase reconnect, optimistic concurrency control version conflicts, and Dexie queue drain.