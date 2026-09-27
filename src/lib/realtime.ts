/**
 * Realtime transport vocabulary.
 *
 * Shared by {@link useSupabaseRealtime} (which produces the state) and by
 * `NetworkIndicator` / `GameShell` (which render it), so the visual layer and
 * the subscription layer can never disagree about what a state means.
 */

import type { SyncState } from "@/engine/types";

/** Lifecycle of the Supabase Realtime channel for one room. */
export type RealtimeConnectionState =
  /** No realtime work in progress (offline-local game, or not mounted yet). */
  | "idle"
  /** First connection attempt in flight. */
  | "connecting"
  /** Channel is subscribed and delivering change events. */
  | "connected"
  /** The channel dropped; a retry is scheduled with backoff. */
  | "reconnecting"
  /** The channel could not be established, or a create/update call failed. */
  | "error"
  /** Realtime is not available in this environment at all. */
  | "unsupported";

/** The subset of connectivity facts the UI renders. */
export interface NetworkPresentation {
  tone: "live" | "pending" | "error" | "idle";
  /** Short label, always safe to render inside a 1-line badge. */
  label: string;
  /** Longer explanation for `title` / assistive tech. */
  detail: string;
  /** Whether the dot should animate. */
  animated: boolean;
}

const CONNECTION_DETAIL: Record<RealtimeConnectionState, string> = {
  idle: "Realtime is not active for this game.",
  connecting: "Opening a realtime channel…",
  connected: "Realtime channel is open.",
  reconnecting: "Realtime channel dropped. Reconnecting…",
  error: "Realtime channel failed. Reconnecting on an interval.",
  unsupported: "Realtime is not available in this environment.",
};

/**
 * Collapses realtime connectivity, browser connectivity and the local sync
 * queue into a single presentation decision.
 *
 * Precedence is deliberate: a data-integrity problem (conflict) outranks a
 * transport problem (error), which outranks an unflushed local write, which
 * outranks a transient reconnect. A player scanning the header should see the
 * most consequential fact first.
 */
export function deriveNetworkPresentation(input: {
  connection: RealtimeConnectionState;
  isOnline: boolean;
  pendingCount: number;
  syncState: SyncState;
}): NetworkPresentation {
  const { connection, isOnline, pendingCount, syncState } = input;

  if (syncState === "conflict") {
    return {
      tone: "error",
      label: "Sync conflict",
      detail: "The server board does not match the replayed move history. Play is halted.",
      animated: false,
    };
  }

  if (connection === "unsupported") {
    return {
      tone: "error",
      label: "Realtime unavailable",
      detail: CONNECTION_DETAIL.unsupported,
      animated: false,
    };
  }

  if (!isOnline) {
    return {
      tone: "pending",
      label: pendingCount > 0 ? `Offline · ${pendingCount} queued` : "Offline",
      detail:
        pendingCount > 0
          ? `${pendingCount} change${pendingCount === 1 ? "" : "s"} will upload when the connection returns.`
          : "Playing locally. Changes upload when the connection returns.",
      animated: false,
    };
  }

  if (connection === "error") {
    return {
      tone: "error",
      label: "Connection error",
      detail: CONNECTION_DETAIL.error,
      animated: true,
    };
  }

  if (connection === "reconnecting") {
    return {
      tone: "pending",
      label: "Reconnecting",
      detail: CONNECTION_DETAIL.reconnecting,
      animated: true,
    };
  }

  if (connection === "connecting") {
    return {
      tone: "pending",
      label: "Connecting",
      detail: CONNECTION_DETAIL.connecting,
      animated: true,
    };
  }

  if (pendingCount > 0) {
    return {
      tone: "pending",
      label: `${pendingCount} queued`,
      detail: `Uploading ${pendingCount} pending change${pendingCount === 1 ? "" : "s"}.`,
      animated: true,
    };
  }

  if (syncState === "pending_upload") {
    return {
      tone: "pending",
      label: "Saving",
      detail: "Uploading the latest move.",
      animated: true,
    };
  }

  if (connection === "connected" && syncState === "synced") {
    return {
      tone: "live",
      label: "Live",
      detail: CONNECTION_DETAIL.connected,
      animated: false,
    };
  }

  return {
    tone: "idle",
    label: "Local",
    detail: "This game runs entirely on this device.",
    animated: false,
  };
}
