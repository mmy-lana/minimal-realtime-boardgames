/**
 * Section 4.1 — session-storage keys for realtime seats.
 *
 * A realtime room's seat token is the only credential the browser holds, and
 * three components have to agree on where it lives: the lobby writes it when a
 * room is created, the realtime route reads it when the invite link is opened,
 * and `GameScreen` reads it again to rebuild the match after a rematch. Those
 * three used to each build their own key out of a template literal, and the
 * template had no application name in it — `room:<id>:seat` is a key any other
 * script on the origin, any other app served from the same path prefix, and
 * any future feature of this one could reasonably have chosen. Two rooms from
 * different games that happened to share an id, or a future `realtime:room:…`
 * namespace, would have silently traded seats.
 *
 * Every key is therefore built here, once, under
 * {@link SEAT_STORAGE_NAMESPACE}. Adding a fourth reader is a one-line import
 * rather than a fourth guess at a string.
 *
 * The namespace is deliberately the one name the spec fixes, `minimal_games`:
 * it is what the deployed rooms were created with, so a link that was shared
 * before this module existed still finds its token.
 */

/** Application prefix. Part of the wire contract — do not change casually. */
export const SEAT_STORAGE_NAMESPACE = "minimal_games";

/** Key holding the opaque seat token this browser owns for `roomId`. */
export function seatTokenKey(roomId: string): string {
  return `${SEAT_STORAGE_NAMESPACE}:room:${roomId}:seat`;
}

/** Key holding which of the two seats that token is: `"black"` or `"white"`. */
export function seatColorKey(roomId: string): string {
  return `${SEAT_STORAGE_NAMESPACE}:room:${roomId}:seat_color`;
}

/**
 * Key holding the opponent's token, known only to the browser that created
 * the room. A joining player never writes it, and must never be handed it.
 */
export function opponentTokenKey(roomId: string): string {
  return `${SEAT_STORAGE_NAMESPACE}:room:${roomId}:opponent`;
}

/**
 * Values held only in memory because `sessionStorage` refused to store them.
 *
 * This is not a convenience cache. When `sessionStorage` throws — Safari in
 * private mode, a browser with site data disabled, a third-party iframe with
 * storage partitioned away — a seat token written by the lobby is discarded on
 * the spot, and the next read of it mints a *different* one. On the server that
 * is not a no-op: the host opens their own invite link, `join_room` is called
 * with a token that matches neither seat, the room is still `waiting` with an
 * empty white seat, and the host is seated as the second player in a game they
 * started. The room is then full and nobody can play it.
 *
 * An in-memory map is not a substitute for real storage — it does not survive a
 * reload, and a link opened in a new tab still gets nothing. It is scoped
 * exactly to what it can fix: the token is written and read within one page
 * session, by the same document, and losing it there is what breaks the room.
 */
const memoryFallback = new Map<string, string>();

/**
 * Reads a session-storage value without assuming a browser environment, and
 * falls back to the in-memory copy when storage is unavailable or refused.
 *
 * `sessionStorage` is consulted first and the memory copy second, so a working
 * storage is always the source of truth. The fallback also covers the partial
 * case where a write reached memory but not storage, which a single `try` around
 * the read cannot distinguish from a value that was never written.
 */
export function readSessionValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key) ?? memoryFallback.get(key) ?? null;
  } catch {
    // Safari in private mode throws on any `sessionStorage` access rather than
    // returning null. A room that cannot remember its seat is still playable —
    // it just re-claims one on the next visit.
    return memoryFallback.get(key) ?? null;
  }
}

/**
 * Writes a session-storage value, tolerating a browser that refuses to store.
 *
 * The memory copy is written unconditionally, on both the success and the
 * failure path. Writing it only on failure would let the two disagree in the
 * other direction — an earlier value in memory that a later successful write
 * has already replaced — and a read would then hand back a stale seat.
 */
export function writeSessionValue(key: string, value: string): void {
  // The environment check comes before the map is touched, not after. A server
  // process shares this module across every request it renders, so populating
  // the map there would grow it without bound and hold one visitor's seat token
  // in memory while another's page is being rendered. It is browser state only.
  if (typeof window === "undefined") return;
  memoryFallback.set(key, value);
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Same private-mode case as above: the room still works, the token is just
    // re-minted on the next visit instead of being remembered.
  }
}
