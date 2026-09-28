import { GAME_METADATA, GAME_KINDS, type GameKind, type SessionMode } from "@/engine/types";
import { GameLobby } from "@/components/lobby/GameLobby";
import { ErrorBoundary } from "@/components/primitives/ErrorBoundary";

export default function HomePage(): React.ReactElement {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-board-light text-board-dark">
      {/*
        The outermost boundary. Nothing above it can catch a failure, so this
        is what stands between a render-time exception and a blank page. The
        narrower boundary inside the lobby handles the case where only the
        saved-games list is at fault and the rest of the page is still worth
        showing.
      */}
      <ErrorBoundary fallbackTitle="The lobby could not be displayed">
        <GameLobby
          games={GAME_KINDS.map((kind: GameKind) => GAME_METADATA[kind])}
          initialMode={"offline_local" satisfies SessionMode}
        />
      </ErrorBoundary>
    </div>
  );
}
