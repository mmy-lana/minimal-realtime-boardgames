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
  | "chess";

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

export type ChessPieceType = "p" | "n" | "b" | "r" | "q" | "k";
export interface ChessPiece {
  color: PlayerColor;
  type: ChessPieceType;
  hasMoved?: boolean;
}
export type ChessCell = ChessPiece | null;
export type ChessBoard = ChessCell[][];

export type UniversalBoard =
  | { kind: "tictactoe"; state: TicTacToeBoard }
  | { kind: "connect4"; state: Connect4Board }
  | { kind: "gomoku"; state: GomokuBoard }
  | { kind: "reversi"; state: ReversiBoard }
  | { kind: "checkers"; state: CheckersBoard }
  | { kind: "chess"; state: ChessBoard };

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

export class MinimalBoardGamesDB extends Dexie {
  games!: Table<GameSession, string>;
  syncQueue!: Table<SyncQueueItem, string>;

  constructor() {
    super("minimal_board_games_db");
    this.version(1).stores({
      games: "id, gameKind, mode, status, updatedAt, syncState",
      syncQueue: "id, gameId, timestamp, retryCount",
    });
  }
}

export const localDb = new MinimalBoardGamesDB();
```

### 1.3 Remote Supabase Database Schema (PostgreSQL DDL)

```sql
create type game_kind as enum ('tictactoe', 'connect4', 'gomoku', 'reversi', 'checkers', 'chess');
create type match_status as enum ('waiting', 'active', 'draw', 'won_black', 'won_white', 'abandoned');
create type player_color as enum ('black', 'white');

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
  ply integer not null,
  player player_color not null,
  from_coord jsonb null,
  to_coord jsonb not null,
  payload text null,
  created_at timestamptz not null default now()
);

alter table public.game_rooms enable row level security;
alter table public.game_moves enable row level security;

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

  -- Validate seat identity and turn order with strict null check
  if p_player = 'black' and (v_room.player_black_token is null or v_room.player_black_token != p_player_token or v_room.current_turn != 'black') then
    return 'unauthorized';
  end if;

  if p_player = 'white' and (v_room.player_white_token is null or v_room.player_white_token != p_player_token or v_room.current_turn != 'white') then
    return 'unauthorized';
  end if;

  -- Idempotent move insertion
  insert into public.game_moves (id, room_id, ply, player, from_coord, to_coord, payload, created_at)
  values (p_move_id, p_room_id, p_ply, p_player, p_from_coord, p_to_coord, p_payload, now())
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

revoke execute on function public.submit_turn_move from public;
grant execute on function public.submit_turn_move to anon, authenticated;

revoke execute on function public.join_room from public;
grant execute on function public.join_room to anon, authenticated;

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
│   │   └── NetworkIndicator.tsx
│   ├── compound/
│   │   ├── GameShell.tsx
│   │   ├── MoveHistoryTimeline.tsx
│   │   ├── PlayerScoreCard.tsx
│   │   └── GameOverDialog.tsx
│   └── boards/
│       ├── TicTacToeBoardView.tsx
│       ├── ConnectFourBoardView.tsx
│       ├── GomokuBoardView.tsx
│       ├── ReversiBoardView.tsx
│       ├── CheckersBoardView.tsx
│       └── ChessBoardView.tsx
├── engine/
│   ├── rules/
│   │   ├── tictactoe.ts
│   │   ├── connect4.ts
│   │   ├── gomoku.ts
│   │   ├── reversi.ts
│   │   ├── checkers.ts
│   │   └── chess.ts
│   ├── factory.ts
│   └── types.ts
├── hooks/
│   ├── useGameSession.ts
│   ├── useNetworkStatus.ts
│   ├── useSyncQueue.ts
│   └── useSupabaseRealtime.ts
└── lib/
    ├── db.ts
    ├── supabase.ts
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
```typescript
import { PlayerColor, TicTacToeBoard } from "../types";

export function createInitialTicTacToeBoard(): TicTacToeBoard {
  return Array(9).fill(null);
}

export function validateTicTacToeMove(board: TicTacToeBoard, index: number): boolean {
  return index >= 0 && index < 9 && board[index] === null;
}

export function applyTicTacToeMove(
  board: TicTacToeBoard,
  index: number,
  player: PlayerColor
): { nextBoard: TicTacToeBoard; winner: PlayerColor | null; isDraw: boolean } {
  const nextBoard = [...board];
  nextBoard[index] = player;

  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  for (const [a, b, c] of lines) {
    if (nextBoard[a] && nextBoard[a] === nextBoard[b] && nextBoard[a] === nextBoard[c]) {
      return { nextBoard, winner: nextBoard[a], isDraw: false };
    }
  }

  const isDraw = nextBoard.every((cell) => cell !== null);
  return { nextBoard, winner: null, isDraw };
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
): { nextBoard: CheckersBoard; winner: PlayerColor | null; isDraw: boolean } {
  const nextBoard = board.map((r) => [...r]);
  const activePiece = nextBoard[move.from.y][move.from.x];

  if (!activePiece || activePiece.color !== player) {
    throw new Error("Invalid checkers move: piece selection error");
  }

  nextBoard[move.from.y][move.from.x] = null;

  let isCrowned = activePiece.type === "king";
  if (player === "black" && move.to.y === CHECKERS_SIZE - 1) isCrowned = true;
  if (player === "white" && move.to.y === 0) isCrowned = true;

  nextBoard[move.to.y][move.to.x] = {
    color: player,
    type: isCrowned ? "king" : "pawn",
  };

  if (move.jumpedCoord) {
    nextBoard[move.jumpedCoord.y][move.jumpedCoord.x] = null;
  }

  const opponent: PlayerColor = player === "black" ? "white" : "black";
  const opponentMoves = getCheckersLegalMoves(nextBoard, opponent);

  let winner: PlayerColor | null = null;
  if (opponentMoves.length === 0) {
    winner = player;
  }

  return { nextBoard, winner, isDraw: false };
}
```

#### 3.1.6 Chess Engine (Deterministic Micro-Engine)
```typescript
import { ChessBoard, ChessCell, ChessPieceType, Coordinates, PlayerColor } from "../types";

export const CHESS_SIZE = 8;

export function createInitialChessBoard(): ChessBoard {
  const layoutOrder: ChessPieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
  const board: ChessBoard = Array.from({ length: CHESS_SIZE }, () =>
    Array(CHESS_SIZE).fill(null)
  );

  for (let c = 0; c < CHESS_SIZE; c++) {
    board[0][c] = { color: "black", type: layoutOrder[c], hasMoved: false };
    board[1][c] = { color: "black", type: "p", hasMoved: false };
    board[6][c] = { color: "white", type: "p", hasMoved: false };
    board[7][c] = { color: "white", type: layoutOrder[c], hasMoved: false };
  }
  return board;
}

export function getBoardCell<T>(board: T[][], x: number, y: number): T | null {
  if (y < 0 || y >= board.length) return null;
  const row = board[y];
  if (!row || x < 0 || x >= row.length) return null;
  return row[x] ?? null;
}

export function getChessRawMoves(
  board: ChessBoard,
  from: Coordinates,
  player: PlayerColor
): Coordinates[] {
  const piece = getBoardCell(board, from.x, from.y);
  if (!piece || piece.color !== player) return [];

  const targets: Coordinates[] = [];
  const pushIfValid = (y: number, x: number): boolean => {
    if (y < 0 || y >= CHESS_SIZE || x < 0 || x >= CHESS_SIZE) return false;
    const dest = getBoardCell(board, x, y);
    if (dest === null) {
      targets.push({ x, y });
      return true;
    }
    if (dest.color !== player) {
      targets.push({ x, y });
    }
    return false;
  };

  switch (piece.type) {
    case "p": {
      const fwd = player === "black" ? 1 : -1;
      const startRank = player === "black" ? 1 : 6;
      const oneStepY = from.y + fwd;
      const twoStepY = from.y + 2 * fwd;

      if (getBoardCell(board, from.x, oneStepY) === null) {
        targets.push({ x: from.x, y: oneStepY });
        if (from.y === startRank && getBoardCell(board, from.x, twoStepY) === null) {
          targets.push({ x: from.x, y: twoStepY });
        }
      }
      for (const diagX of [from.x - 1, from.x + 1]) {
        if (diagX >= 0 && diagX < CHESS_SIZE) {
          const dest = getBoardCell(board, diagX, oneStepY);
          if (dest && dest.color !== player) {
            targets.push({ x: diagX, y: oneStepY });
          }
        }
      }
      break;
    }
    case "n": {
      const knightOffsets = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2],  [1, 2],  [2, -1],  [2, 1],
      ];
      for (const [dy, dx] of knightOffsets) {
        pushIfValid(from.y + dy, from.x + dx);
      }
      break;
    }
    case "b":
    case "r":
    case "q": {
      const dirs: number[][] = [];
      if (piece.type === "r" || piece.type === "q") {
        dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
      }
      if (piece.type === "b" || piece.type === "q") {
        dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
      }
      for (const [dy, dx] of dirs) {
        let step = 1;
        while (pushIfValid(from.y + dy * step, from.x + dx * step)) {
          if (getBoardCell(board, from.x + dx * step, from.y + dy * step) !== null) break;
          step++;
        }
      }
      break;
    }
    case "k": {
      const kingDirs = [
        [-1, -1], [-1, 0], [-1, 1],
        [0, -1],           [0, 1],
        [1, -1],  [1, 0],  [1, 1],
      ];
      for (const [dy, dx] of kingDirs) {
        pushIfValid(from.y + dy, from.x + dx);
      }
      break;
    }
  }

  return targets;
}

export function applyChessMove(
  board: ChessBoard,
  from: Coordinates,
  to: Coordinates,
  player: PlayerColor
): { nextBoard: ChessBoard; winner: PlayerColor | null; isDraw: boolean } {
  const rawMoves = getChessRawMoves(board, from, player);
  const isValid = rawMoves.some((m) => m.x === to.x && m.y === to.y);

  if (!isValid) {
    throw new Error("Invalid chess move requested");
  }

  const nextBoard = board.map((r) => [...r]);
  const activePiece = nextBoard[from.y][from.x]!;
  const targetSquare = nextBoard[to.y][to.x];

  let winner: PlayerColor | null = null;
  if (targetSquare && targetSquare.type === "k") {
    winner = player;
  }

  nextBoard[from.y][from.x] = null;
  nextBoard[to.y][to.x] = { ...activePiece, hasMoved: true };

  return { nextBoard, winner, isDraw: false };
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
6. Build `CheckersBoardView.tsx` and `ChessBoardView.tsx` with two-tone cell grids and piece markers.
7. Construct `MoveHistoryTimeline.tsx` displaying plies in algebraic or coordinate notation.

### Phase 4: Domain Logic, Reactive State, and Specialized APIs
1. Implement rule engines: `tictactoe.ts`, `connect4.ts`, `gomoku.ts`, `reversi.ts`, `checkers.ts`, and `chess.ts`.
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
5. Test offline disconnection, Docker Supabase reconnect, optimistic concurrency control version conflicts, and Dexie queue drain.