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

/** Reads a session-storage value without assuming a browser environment. */
export function readSessionValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Safari in private mode throws on any `sessionStorage` access rather than
    // returning null. A room that cannot remember its seat is still playable —
    // it just re-claims one on the next visit.
    return null;
  }
}

/** Writes a session-storage value, tolerating a browser that refuses to store. */
export function writeSessionValue(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Same private-mode case as above: the room still works, the token is just
    // re-minted on the next visit instead of being remembered.
  }
}
