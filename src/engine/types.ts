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
