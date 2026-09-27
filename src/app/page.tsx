import { GAME_METADATA, GAME_KINDS, type GameKind, type SessionMode } from "@/engine/types";
import { GameLobby } from "@/components/lobby/GameLobby";

export default function HomePage(): React.ReactElement {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-board-light text-board-dark">
      <GameLobby
        games={GAME_KINDS.map((kind: GameKind) => GAME_METADATA[kind])}
        initialMode={"offline_local" satisfies SessionMode}
      />
    </div>
  );
}
