/**
 * @vitest-environment jsdom
 *
 * DATA-CRASH-01 — a proof that the home page crashed on legacy data.
 *
 * This file is written to be deleted by the fix. Every test here describes a
 * failure, not a feature: an IndexedDB row left behind by the `chess` ->
 * `hex` rename that took the whole page down with a `TypeError`, and a
 * metadata lookup that threw on any kind this build does not know.
 *
 * They are kept separate from the main suites on purpose. A test that pins
 * down "this no longer crashes" is only worth anything if it was seen failing
 * first, and it is much easier to believe in a file whose every line is about
 * one bug.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GAME_KINDS,
  GAME_METADATA,
  getGameMetadata,
  isGameKind,
  type GameMetadata,
} from "@/engine/types";
import { getLocalDb, listSessionsByRecentActivity, LOCAL_DB_SCHEMA_VERSION } from "@/lib/db";
import { createGameSession } from "@/hooks/useGameSession";
import { GameLobby } from "@/components/lobby/GameLobby";
import { MinimalBoardGamesDB } from "@/lib/db";
import type { MoveRecord, SyncQueueItem } from "@/engine/types";

/**
 * The lobby navigates rather than holding session state, so it reaches for the
 * app router. There is no app router in a unit test, and the real `useRouter`
 * throws an invariant when there is not one — which would fail these tests for
 * a reason that has nothing to do with the bug under test.
 */
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

afterEach(cleanup);

/**
 * The six cards the home page offers, built the way `app/page.tsx` builds
 * them: a straight catalog lookup over the live kinds. Note this is *not*
 * `GAME_KINDS.map(getGameMetadata)` — that yields the wider return type,
 * which is the point of the union, and `GameLobby` accepts only real entries.
 */
const CATALOG: readonly GameMetadata[] = GAME_KINDS.map((kind) => GAME_METADATA[kind]);

/** A row as an older build would have left it: valid in every way but the kind. */
function legacyRow(id: string, gameKind: string): Record<string, unknown> {
  const session = createGameSession({
    id,
    gameKind: "hex",
    mode: "offline_local",
    playerBlackToken: "token",
  });
  return { ...session, gameKind };
}

describe("DATA-CRASH-01: legacy rows in IndexedDB", () => {
  beforeEach(async () => {
    await getLocalDb().transaction("rw", getLocalDb().games, getLocalDb().syncQueue, async () => {
      await getLocalDb().games.clear();
      await getLocalDb().syncQueue.clear();
    });
  });

  it("the schema version is high enough to carry a migration", () => {
    // If this is ever 1 again, no upgrade hook can run and every test below is
    // testing a fix that is not installed.
    expect(LOCAL_DB_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("isGameKind rejects every kind the rename retired", () => {
    expect(isGameKind("chess")).toBe(false);
    expect(isGameKind("unknown")).toBe(false);
    expect(isGameKind(null)).toBe(false);
    expect(isGameKind(undefined)).toBe(false);
    // ...and still accepts all six that are live.
    for (const kind of GAME_KINDS) expect(isGameKind(kind)).toBe(true);
  });

  it("getGameMetadata returns metadata for a retired kind instead of throwing", () => {
    // The lookup this replaces was `GAME_METADATA[kind]`, which is `undefined`
    // for "chess" — and every caller then read `.name` off it.
    const meta = getGameMetadata("chess" as never);
    expect(meta).toBeDefined();
    expect(typeof meta.name).toBe("string");
    expect(meta.name.length).toBeGreaterThan(0);
  });

  it("getGameMetadata survives every shape a corrupt row can hold", () => {
    for (const bad of ["", "chess", "unknown", "HEX", "0", null, undefined, 42, {}, []]) {
      const meta = getGameMetadata(bad as never);
      expect(meta, `input ${JSON.stringify(bad)}`).toBeDefined();
      expect(typeof meta.name, `input ${JSON.stringify(bad)}`).toBe("string");
      expect(typeof meta.shortName, `input ${JSON.stringify(bad)}`).toBe("string");
      expect(meta.players).toBe(2);
    }
  });

  it("the lobby renders when every stored row is a retired kind", async () => {
    // The exact reported crash: `GAME_METADATA[session.gameKind].name` threw
    // inside the `.map`, so the whole page was unmounted by React.
    await getLocalDb().games.bulkPut([
      legacyRow("legacy-1", "chess") as never,
      legacyRow("legacy-2", "unknown") as never,
    ]);

    render(
      <GameLobby
        games={CATALOG}
        initialMode="offline_local"
      />
    );

    // `useLiveQuery` is async, so the rows arrive a tick after first paint — and
    // the crash happens on the render that reads them, not on the one that
    // mounts. Waiting for the empty state to appear is what actually drives the
    // faulty code; a bare `act()` would return before it ever ran.
    await waitFor(() => {
      expect(
        screen.getByText(/no saved sessions yet/i).closest("section")
      ).toBeTruthy();
    });

    // And the page itself is still there.
    for (const kind of GAME_KINDS) {
      expect(
        screen.getByLabelText(new RegExp(`Play ${getGameMetadata(kind).name}`, "i")),
        `missing card for ${kind}`
      ).toBeTruthy();
    }
  });

  it("the lobby renders when legacy rows sit alongside real ones", async () => {
    // The realistic shape: one stale row from before the rename, and the
    // sessions the player has played since.
    await getLocalDb().games.bulkPut([
      legacyRow("legacy-1", "chess") as never,
      createGameSession({
        id: "real-1",
        gameKind: "checkers",
        mode: "offline_local",
        playerBlackToken: "token",
      }),
    ]);

    render(
      <GameLobby
        games={CATALOG}
        initialMode="offline_local"
      />
    );

    // The surviving row is offered, and nothing links to a dead route.
    await waitFor(() => {
      const hrefs = [...document.querySelectorAll("a[href]")].map(
        (a) => a.getAttribute("href") ?? ""
      );
      expect(hrefs.some((href) => href.includes("real-1"))).toBe(true);
      expect(hrefs.some((href) => href.includes("legacy-1"))).toBe(false);
    });
  });

  it("the lobby renders an empty recent list without a session", async () => {
    expect(await listSessionsByRecentActivity()).toEqual([]);
    render(
      <GameLobby
        games={CATALOG}
        initialMode="offline_local"
      />
    );
    expect(screen.getByLabelText(/recent sessions/i)).toBeTruthy();
  });
});

/**
 * DATA-MIG-01 — the upgrade hook itself.
 *
 * The lobby tests above inject legacy rows into an already-migrated database,
 * so they cover the *read* path but say nothing about the *migration*. These
 * build a genuine v1 database the way an older build would have written it,
 * then open the current class over it and check that the upgrade ran.
 */
describe("DATA-MIG-01: the v1 -> v2 upgrade hook", () => {
  const V1_DB = "upgrade_probe_db";

  beforeEach(async () => {
    // Open at v1 with the v1 schema only, and write rows the way the old
    // build would have: a retired kind, a corrupt kind, and a good one.
    const v1 = new Dexie(V1_DB);
    v1.version(1).stores({
      games: "id, gameKind, mode, status, updatedAt, syncState",
      syncQueue: "id, gameId, timestamp, retryCount",
    });
    const good = createGameSession({
      id: "good-1",
      gameKind: "checkers",
      mode: "offline_local",
      playerBlackToken: "t",
    });
    const move: MoveRecord = {
      id: "move-1",
      gameId: "good-1",
      ply: 1,
      player: "black",
      to: { x: 0, y: 1 },
      timestamp: 1,
    };
    const orphanMove: MoveRecord = { ...move, id: "move-orphan", gameId: "gone-1" };
    const queueForRetired: SyncQueueItem = {
      id: "q-1",
      gameId: "retired-1",
      action: "MOVE",
      payload: move,
      timestamp: 1,
      retryCount: 0,
    };

    await v1.table("games").bulkPut([
      { ...good, id: "retired-1", gameKind: "chess" },
      { ...good, id: "corrupt-1", gameKind: "not-a-game" },
      { ...good, id: "no-kind-1", gameKind: undefined },
      good,
    ]);
    await v1.table("syncQueue").bulkPut([
      queueForRetired,
      orphanMove,
      { ...move, id: "move-2" },
    ]);

    v1.close();
  });

  afterEach(async () => {
    // `delete()` takes no arguments: the instance already knows its name.
    await new MinimalBoardGamesDB(V1_DB).delete();
  });

  it("prunes sessions whose kind this build cannot play, and keeps the rest", async () => {
    const db = new MinimalBoardGamesDB(V1_DB);
    await db.open();

    const rows = await db.games.toArray();
    expect(rows.map((r) => r.id).sort()).toEqual(["good-1"]);

    await db.delete();
  });

  it("keeps a queued move that belongs to a surviving session", async () => {
    // The regression this guards: pruning the queue by testing the payload's
    // `gameKind` would delete this row, because a `MoveRecord` has no such
    // field at all — silently discarding a move the player has already made.
    const db = new MinimalBoardGamesDB(V1_DB);
    await db.open();

    const queued = await db.syncQueue.toArray();
    expect(queued.map((q) => q.id).sort()).toEqual(["move-2"]);

    await db.delete();
  });

  it("is idempotent: reopening does not prune the live session", async () => {
    const first = new MinimalBoardGamesDB(V1_DB);
    await first.open();
    await first.close();

    const second = new MinimalBoardGamesDB(V1_DB);
    await second.open();
    expect((await second.games.toArray()).map((r) => r.id)).toEqual(["good-1"]);

    await second.delete();
  });
});

/**
 * REL-ERR-01 — the boundary is actually wired to the right subtree.
 *
 * A boundary that is defined but never mounted is dead code. This makes a
 * render-time fault happen inside the saved-games list and checks what the
 * player is left with: the history list replaced by an error card, and every
 * game still one click away.
 *
 * The fault is injected at the lookup the list performs while rendering, not
 * at the database query. That distinction is the whole point: a boundary
 * catches errors thrown during render, and the defect this repository was
 * audited for was a `TypeError` thrown from inside a `.map`. A rejected
 * promise from an async hook fails somewhere else entirely and no boundary
 * above it can intercept that.
 */
describe("REL-ERR-01: the recent-sessions boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/engine/types", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/engine/types")>();
      return {
        ...actual,
        // Fails only on the path the recent-sessions list takes; the grid reads
        // `GAME_METADATA` directly, so the rest of the lobby is unaffected.
        getGameMetadata: () => {
          throw new Error("catalog entry is missing");
        },
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("@/engine/types");
    vi.resetModules();
  });

  it("keeps the game grid on screen when rendering the session list throws", async () => {
    const { GAME_KINDS: KINDS, GAME_METADATA: META } = await import("@/engine/types");
    const { GameLobby: Lobby } = await import("@/components/lobby/GameLobby");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // The prop is built from the record, not through the throwing accessor, so
    // the failure is confined to the section under test.
    render(<Lobby games={KINDS.map((kind) => META[kind])} initialMode="offline_local" />);

    // At least one real row, so the list has something to render and actually
    // reaches the accessor. With no rows it short-circuits to the empty state
    // and the fault would never occur.
    const { getLocalDb } = await import("@/lib/db");
    const { createGameSession } = await import("@/hooks/useGameSession");
    await getLocalDb().games.put(
      createGameSession({
        id: "listed-1",
        gameKind: "checkers",
        mode: "offline_local",
        playerBlackToken: "t",
      })
    );
    await waitFor(() => {
      expect(screen.getByText("Could not load recent games")).toBeTruthy();
    });
    expect(screen.getByText("catalog entry is missing")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();

    // A player who cannot load their history must still be able to start a
    // game. That is the whole reason the boundary is scoped to this section
    // rather than to the page.
    for (const kind of KINDS) {
      expect(screen.getByLabelText(new RegExp(`Play ${META[kind].name}`, "i"))).toBeTruthy();
    }
    consoleError.mockRestore();
  });
});
