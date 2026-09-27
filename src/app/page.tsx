import Link from "next/link";
import { GameKind } from "@/engine/types";

interface GameOption {
  kind: GameKind;
  name: string;
  grid: string;
  players: string;
}

const GAMES: GameOption[] = [
  { kind: "tictactoe", name: "Tic-Tac-Toe", grid: "3x3", players: "2 Players" },
  { kind: "connect4", name: "Connect Four", grid: "7x6", players: "2 Players" },
  { kind: "gomoku", name: "Gomoku", grid: "15x15", players: "2 Players" },
  { kind: "reversi", name: "Reversi", grid: "8x8", players: "2 Players" },
  { kind: "checkers", name: "Checkers", grid: "8x8", players: "2 Players" },
  { kind: "chess", name: "Chess", grid: "8x8", players: "2 Players" },
];

export default function HomePage() {
  return (
    <div className="flex w-full max-w-4xl flex-col px-4 py-8 md:py-16">
      <header className="mb-12 border-b border-neutral-200 pb-6">
        <h1 className="text-xl font-bold tracking-tight uppercase">
          Minimal Board Games
        </h1>
        <p className="mt-1 text-xs text-neutral-500 uppercase tracking-widest">
          Offline-First &bull; Realtime WebSockets &bull; Ultra-Minimalist
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {GAMES.map((game) => (
          <Link
            key={game.kind}
            href={`/${game.kind}`}
            className="group flex flex-col justify-between border border-neutral-200 p-6 transition-colors hover:border-neutral-900 hover:bg-neutral-50"
          >
            <div>
              <div className="text-xs font-mono text-neutral-400 uppercase">
                {game.grid}
              </div>
              <h2 className="mt-2 text-base font-semibold text-neutral-900">
                {game.name}
              </h2>
            </div>
            <div className="mt-8 flex items-center justify-between text-xs text-neutral-500 font-mono">
              <span>{game.players}</span>
              <span className="group-hover:translate-x-1 transition-transform">
                &rarr;
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
