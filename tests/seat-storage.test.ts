/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-TOKEN-01 — a seat token must survive a browser that refuses to store it.
 *
 * The previous implementation swallowed every `sessionStorage` failure and
 * returned null, which reads like a graceful degradation and is not one. The
 * seat token is the only credential this app holds, it is written by the lobby
 * and read back by the realtime route in the same page session, and losing it
 * does not degrade gracefully — it changes the outcome of the server call.
 *
 * The concrete failure: the host creates a room, so the room is `waiting` with
 * the host's token on black and no white seat. If the token is dropped, opening
 * the host's own invite link mints a *new* token, `join_room` is called with
 * one that matches neither seat, the room is still waiting with an empty white
 * seat, and the host is seated as the second player in a game they started. The
 * room is then full and unplayable.
 *
 * The hostile cases below make `window.sessionStorage` itself throw on access,
 * which is what Safari in private mode does. An earlier version of this file
 * only made `getItem` throw, which passes against the old implementation and
 * proves nothing — the getter never gets a chance to fail if the property
 * access already threw.
 */

const { opponentTokenKey, readSessionValue, seatColorKey, seatTokenKey, writeSessionValue } =
  await import("@/lib/seatStorage");

/** Replaces `window.sessionStorage` with one that throws on every access. */
function blockSessionStorage(): void {
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
}

/** Replaces `window.sessionStorage` with a working one. */
function restoreSessionStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get: () =>
      ({
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      }) as unknown as Storage,
  });
}

/**
 * jsdom's `window` is not restored by `vi.unstubAllGlobals`, so the original
 * descriptor is captured once and put back by hand. Without this the SSR test
 * leaves `window` undefined and every later helper throws on it.
 */
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function setWindow(value: unknown): void {
  Object.defineProperty(globalThis, "window", { value, configurable: true, writable: true });
}

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  restoreSessionStorage();
  vi.restoreAllMocks();
});

describe("SEC-TOKEN-01: the in-memory fallback", () => {
  it("returns a token written while storage was blocked", () => {
    blockSessionStorage();

    writeSessionValue(seatTokenKey("blocked-1"), "seat-black-token");
    writeSessionValue(seatColorKey("blocked-1"), "black");

    expect(readSessionValue(seatTokenKey("blocked-1"))).toBe("seat-black-token");
    expect(readSessionValue(seatColorKey("blocked-1"))).toBe("black");
  });

  it("keeps the host's seat token identical across the write and the read", () => {
    // The defect in one assertion. A lost token is not merely a cache miss:
    // the route reads null, mints a replacement, and joins the wrong seat.
    blockSessionStorage();

    const key = seatTokenKey("host-1");
    const written = "opaque-token-abc";
    writeSessionValue(key, written);

    expect(readSessionValue(key)).toBe(written);
  });

  it("falls back when reads throw but writes are accepted", () => {
    // A quota or permission failure on write with a working getter is the
    // partial case: a single try/catch around the read alone would return null
    // here and mint a new seat.
    const store = new Map<string, string>();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () =>
        ({
          getItem: () => {
            throw new DOMException("read denied", "SecurityError");
          },
          setItem: (key: string, value: string) => void store.set(key, value),
        }) as unknown as Storage,
    });

    const key = seatTokenKey("partial-1");
    writeSessionValue(key, "seat-partial");
    expect(store.get(key)).toBe("seat-partial");
    expect(readSessionValue(key)).toBe("seat-partial");
  });

  it("falls back when a value reached memory but not storage", () => {
    // A write that failed on quota, then a later read. Storage answers
    // "absent" rather than throwing, and only the memory copy knows the value.
    let allowWrites = false;
    const store = new Map<string, string>();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () =>
        ({
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => {
            if (!allowWrites) throw new DOMException("quota", "QuotaExceededError");
            store.set(key, value);
          },
        }) as unknown as Storage,
    });

    const key = seatTokenKey("quota-1");
    writeSessionValue(key, "seat-quota");

    allowWrites = true;
    expect(readSessionValue(key)).toBe("seat-quota");
  });

  it("prefers real storage when both hold a value", () => {
    // sessionStorage is the source of truth whenever it works, so a page that
    // reloads does not come back holding a token from a previous document.
    restoreSessionStorage();
    const key = seatTokenKey("both-1");

    writeSessionValue(key, "first");
    writeSessionValue(key, "second");

    expect(readSessionValue(key)).toBe("second");
    expect(window.sessionStorage.getItem(key)).toBe("second");
  });

  it("does not resurrect a value the page deliberately cleared", () => {
    // Writing the same key to a null value is how a caller abandons a seat.
    // Storage holds the empty string, which is not the same as "absent", so the
    // read must return it rather than falling through to the memory copy.
    restoreSessionStorage();
    const key = seatTokenKey("cleared-1");

    writeSessionValue(key, "seat-token");
    window.sessionStorage.setItem(key, "");

    expect(readSessionValue(key)).toBe("");
  });

  it("returns null outside a browser without touching the fallback", () => {
    // Server rendering must not leak one request's memory into another's, and
    // there is no window to read from in the first place. The write is checked
    // too: a server process shares this module across every request, so a
    // write that populated the map would hold one visitor's seat token in
    // memory while another's page rendered.
    const key = seatTokenKey("ssr-1");
    setWindow(undefined);

    writeSessionValue(key, "server-token");
    expect(readSessionValue(key)).toBeNull();

    setWindow(originalWindow?.value);
    expect(readSessionValue(key)).toBeNull();
  });

  it("keeps room keys separate in the fallback", () => {
    // The fallback shares one map, so the namespace in `seatStorage` is the only
    // thing stopping one room's seat from being served for another's.
    blockSessionStorage();

    writeSessionValue(seatTokenKey("room-a"), "token-a");
    writeSessionValue(seatTokenKey("room-b"), "token-b");
    writeSessionValue(opponentTokenKey("room-a"), "opponent-a");

    expect(readSessionValue(seatTokenKey("room-a"))).toBe("token-a");
    expect(readSessionValue(seatTokenKey("room-b"))).toBe("token-b");
    expect(readSessionValue(opponentTokenKey("room-a"))).toBe("opponent-a");
    expect(readSessionValue(seatTokenKey("room-c"))).toBeNull();
  });
});
