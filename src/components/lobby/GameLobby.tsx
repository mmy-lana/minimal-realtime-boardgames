"use client";

/**
 * Phase 5.1 — the six-game selector matrix with the mode toggle.
 *
 * The mode control sits above the grid, not per card, because it is a
 * statement about the whole session: one device, one seat, either played
 * offline against nothing or joined to a room. Putting it on each card would
 * imply six independent choices when there is only one.
 *
 * Choosing a game navigates rather than starting work here, so the lobby owns
 * no session state at all. `offline_local` goes to `/[gameKind]`, where the
 * session is auto-instantiated in Dexie; `online_realtime` goes to
 * `/[gameKind]/[roomId]`, where a room id is minted once and shared.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";

import {
  GAME_METADATA,
  GameKind,
  SessionMode,
  type GameMetadata,
} from "@/engine/types";
import { listSessionsByRecentActivity } from "@/lib/db";
import { createId, createSeatToken, formatRelativeTime } from "@/lib/utils";
import { Badge } from "@/components/primitives/Badge";
import { SegmentedControl } from "@/components/primitives/SegmentedControl";
import { NetworkIndicator } from "@/components/primitives/NetworkIndicator";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useSyncQueue } from "@/hooks/useSyncQueue";

export interface GameLobbyProps {
  readonly games: readonly GameMetadata[];
  readonly initialMode: SessionMode;
}

const MODE_OPTIONS = [
  { value: "offline_local", label: "Local" },
  { value: "online_realtime", label: "Realtime" },
] as const satisfies readonly { value: SessionMode; label: string }[];

export function GameLobby({ games, initialMode }: GameLobbyProps): React.ReactElement {
  const router = useRouter();
  const [mode, setMode] = useState<SessionMode>(initialMode);
  const [pendingKind, setPendingKind] = useState<GameKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isOnline, status } = useNetworkStatus();
  // A local session never reaches for the network, so the queue is drained
  // only while the lobby is actually offering realtime rooms.
  const { pendingCount, lastError: queueError } = useSyncQueue({ autoDrain: mode === "online_realtime" });

  const start = useCallback(
    (kind: GameKind) => {
      setError(null);
      if (mode === "offline_local") {
        setPendingKind(kind);
        router.push(`/${kind}`);
        return;
      }
      if (!isOnline) {
        setError("Realtime rooms need a connection. Reconnect, or switch to Local.");
        return;
      }
      setPendingKind(kind);
      // The room id is minted here and the seat token is generated alongside
      // it, so the URL the player shares is the whole invitation.
      const roomId = createId();
      const seat = createSeatToken();
      sessionStorage.setItem(`room:${roomId}:seat`, seat);
      sessionStorage.setItem(`room:${roomId}:seat-color`, "black");
      router.push(`/${kind}/${roomId}`);
    },
    [isOnline, mode, router]
  );

  const canStart = pendingKind === null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 md:py-12">
      <header className="flex flex-col gap-4 border-b border-hairline pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Minimal Board Games</h1>
          <p className="mt-1 text-xs uppercase tracking-widest text-board-muted">
            Offline-first &middot; Realtime &middot; Six classic rulesets
          </p>
        </div>
        <NetworkIndicator
          connection="idle"
          isOnline={isOnline}
          pendingCount={pendingCount}
          syncState="synced"
          className="self-start sm:self-auto"
        />
      </header>

      <div className="mt-6 max-w-sm">
        <SegmentedControl
          name="session-mode"
          label="Mode"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
          options={MODE_OPTIONS}
          hint={
            mode === "offline_local"
              ? "Played on this device. Moves are written to IndexedDB and never leave it."
              : "Creates a room and subscribes to its Supabase Realtime channel. Share the link to invite an opponent."
          }
        />
      </div>

      {mode === "online_realtime" && !isOnline ? (
        <p
          role="status"
          className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-board-dark"
        >
          {status === "checking" ? "Checking the connection…" : "You are offline."} Realtime rooms
          are unavailable until the connection returns; Local games are unaffected.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-board-dark">
          {error}
        </p>
      ) : null}

      {queueError && mode === "online_realtime" ? (
        <p role="status" className="mt-4 rounded-md border border-hairline bg-board-subtle px-3 py-2 text-xs text-board-muted">
          {queueError} Your {pendingCount === 1 ? "move is" : "moves are"} queued locally and will be
          sent when the connection recovers.
        </p>
      ) : null}

      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => (
          <li key={game.kind}>
            <button
              type="button"
              onClick={() => start(game.kind)}
              disabled={!canStart}
              aria-label={`Play ${game.name} ${mode === "offline_local" ? "locally" : "in realtime"}`}
              className="group flex h-full w-full flex-col justify-between rounded-lg border border-hairline bg-board-light p-5 text-left transition-colors hover:border-board-dark hover:bg-board-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-board-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div>
                <p className="font-mono text-[11px] uppercase tracking-widest text-board-muted">
                  {game.gridLabel}
                </p>
                <h2 className="mt-1.5 text-base font-semibold">{game.name}</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-board-muted">{game.description}</p>
              </div>
              <span className="mt-6 flex items-center justify-between text-xs text-board-muted">
                <span>
                  {game.players} &middot;{" "}
                  {mode === "offline_local" ? "Local" : "Realtime"}
                </span>
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                >
                  &rarr;
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <RecentSessions />

      <footer className="mt-8 border-t border-hairline pt-4">
        <p className="text-xs text-board-muted">
          Sessions persist in IndexedDB. Nothing is sent anywhere in Local mode.
        </p>
      </footer>
    </div>
  );
}

/**
 * The resume list, straight from Dexie.
 *
 * This is deliberately a live query rather than a cached array: a session
 * opened in another tab writes to the same table, and the lobby should show it
 * without a refresh. An empty table is a normal state here — a first-time
 * visitor has no history — so it renders one quiet line, not an error.
 */
function RecentSessions(): React.ReactElement | null {
  const sessions = useLiveQuery(
    () => listSessionsByRecentActivity().then((rows) => rows.slice(0, 4)),
    [],
    undefined
  );

  if (!sessions || sessions.length === 0) {
    return (
      <section aria-label="Recent sessions" className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-board-muted">Recent</h2>
        <p className="mt-2 text-xs text-board-muted">
          No saved sessions yet. Pick a game above to start one.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Recent sessions" className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-board-muted">Recent</h2>
      <ul className="mt-2 divide-y divide-hairline border-y border-hairline">
        {sessions.map((session) => {
          const href =
            session.mode === "online_realtime"
              ? `/${session.gameKind}/${session.id}`
              : `/${session.gameKind}?session=${session.id}`;
          return (
            <li key={session.id}>
              <Link
                href={href}
                className="flex items-center gap-3 py-2.5 text-sm transition-colors hover:bg-board-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-board-dark"
              >
                <span className="min-w-0 flex-1 truncate">
                  {GAME_METADATA[session.gameKind].name}
                </span>
                <span className="shrink-0 text-xs text-board-muted">
                  {formatRelativeTime(session.updatedAt)}
                </span>
                <Badge tone={session.status === "active" ? "pending" : "neutral"}>
                  {session.status === "active" ? "In play" : "Finished"}
                </Badge>
                <Badge tone={session.syncState === "conflict" ? "error" : "neutral"}>
                  {session.syncState === "conflict"
                    ? "Conflict"
                    : session.syncState === "pending_upload"
                      ? "Queued"
                      : "Synced"}
                </Badge>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
