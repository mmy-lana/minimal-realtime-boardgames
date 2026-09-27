"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { SyncState } from "@/engine/types";
import { deriveNetworkPresentation, type NetworkPresentation, type RealtimeConnectionState } from "@/lib/realtime";

export interface NetworkIndicatorProps {
  /** Lifecycle of the realtime channel backing this game. */
  connection: RealtimeConnectionState;
  /** `navigator.onLine`, surfaced through `useNetworkStatus`. */
  isOnline: boolean;
  /** Number of queued writes in the local sync queue. */
  pendingCount: number;
  /** Sync state of the current session. */
  syncState: SyncState;
  /** Render the dot + label. Defaults to `true`. */
  showLabel?: boolean;
  className?: string;
}

const TONE_CLASSES = {
  live: "bg-status-live",
  pending: "bg-status-pending",
  error: "bg-status-error",
  idle: "bg-status-idle",
} as const;

/**
 * What the server-rendered markup shows.
 *
 * The real answer depends on `navigator.onLine` and on the realtime channel's
 * own state machine, neither of which exists during SSR or the first client
 * render. Emitting a *guessed* answer would make the hydrated tree differ from
 * the markup React produced on the server — the whole indicator is a `title`
 * attribute and a label, so a wrong guess is exactly a hydration mismatch. The
 * placeholder says nothing false ("Checking…"), and the first `useEffect` pass
 * replaces it with the real presentation.
 */
const PLACEHOLDER: NetworkPresentation = {
  tone: "idle",
  label: "Checking…",
  detail: "Checking this match's connection.",
  animated: false,
};

/**
 * Header connectivity readout (Section 2.4).
 *
 * Driven entirely by `navigator.onLine` plus the realtime channel's own state
 * machine — it never polls the network, and it never claims "Live" while the
 * local sync queue still holds unflushed writes.
 *
 * The region is an `aria-live="polite"` status so a screen reader announces
 * connectivity changes without stealing focus.
 */
export function NetworkIndicator({
  connection,
  isOnline,
  pendingCount,
  syncState,
  showLabel = true,
  className,
}: NetworkIndicatorProps) {
  // `mounted` is the whole fix for the hydration mismatch this component used
  // to throw. The props that decide the presentation are read from the browser
  // (`navigator.onLine`) and from a channel that only exists on the client, so
  // the server has no way to know them. Rather than rendering a value the
  // client immediately contradicts, the server renders {@link PLACEHOLDER} and
  // the first effect swaps in the truth. Both renders are the same component
  // with the same markup shape, so reconciliation is a text swap.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const presentation = React.useMemo(
    () =>
      mounted
        ? deriveNetworkPresentation({ connection, isOnline, pendingCount, syncState })
        : PLACEHOLDER,
    [mounted, connection, isOnline, pendingCount, syncState],
  );

  return (
    <div
      role="status"
      aria-live="polite"
      title={presentation.detail}
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest",
        presentation.tone === "error"
          ? "text-status-error"
          : presentation.tone === "pending"
            ? "text-status-pending"
            : presentation.tone === "live"
              ? "text-status-live"
              : "text-board-muted",
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-tone={presentation.tone}
        data-network-dot=""
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          TONE_CLASSES[presentation.tone],
          presentation.animated && "animate-pulse",
        )}
      />
      {showLabel ? <span className="truncate">{presentation.label}</span> : null}
      <span className="sr-only">{presentation.detail}</span>
    </div>
  );
}

export default NetworkIndicator;
