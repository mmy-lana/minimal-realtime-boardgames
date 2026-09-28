"use client";

import * as React from "react";
import { Button } from "@/components/primitives/Button";
import { LOCAL_DB_NAME, isLocalDbAvailable } from "@/lib/db";

/**
 * The last line of defence between a render-time exception and a blank page.
 *
 * React unmounts the entire tree when a render throws and no boundary catches
 * it. On this app that is worse than a lost feature: a player who is one
 * corrupt IndexedDB row away from a crash cannot start a new game, cannot get
 * back to the lobby, and cannot see anything at all to report. A boundary turns
 * that dead end into a page that still says what happened and offers a way out.
 *
 * Two recovery routes, in increasing order of cost:
 * - *Try again* re-mounts the subtree from scratch. Free, reversible, and the
 *   right answer whenever the fault was transient or a live query re-seeded.
 * - *Reset local data* deletes the local database. Destructive and
 *   irreversible — it is the only route out when the stored data itself is what
 *   is broken — so it is behind an explicit confirmation.
 *
 * What this does not catch: an error thrown from an effect, a rejected promise,
 * or an event handler. React only routes *render-phase* errors to a boundary,
 * so a failing `useEffect` or an async query that rejects is not something any
 * boundary above it can intercept. Components that read from storage still need
 * to handle their own rejections; this covers the failures that take the page
 * down rather than the ones that merely blank a list.
 */
export interface ErrorBoundaryProps {
  /** Heading shown above the error. Describes *where* the failure was. */
  fallbackTitle?: string;
  /**
   * Rendered instead of the default card. Receives the error and a `reset`
   * callback that re-mounts the children; the caller owns the "reset local
   * data" affordance in that case.
   */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  /**
   * Changing any of these clears a caught error, so a boundary reused across
   * routes gets a fresh attempt when the player navigates somewhere new
   * instead of showing the previous route's failure forever.
   */
  resetKeys?: readonly unknown[];
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** Bumped on reset to force a full remount of the subtree, not a re-render. */
  generation: number;
  /** True once the destructive action has been asked for and not yet confirmed. */
  confirmingReset: boolean;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(`Unexpected error: ${JSON.stringify(value)}`);
  } catch {
    return new Error("Unexpected error.");
  }
}

/**
 * Deletes every local game and queued write.
 *
 * Deliberately exhaustive and deliberately unguarded against a partial
 * failure: a reset the player asked for has to actually reset, and leaving a
 * half-deleted database behind would return them to the same broken state they
 * just escaped. Seat credentials go too, since a stale token for a room that no
 * longer exists locally is indistinguishable from a real one on reload.
 */
async function resetLocalData(): Promise<void> {
  if (isLocalDbAvailable()) {
    try {
      const { getLocalDb } = await import("@/lib/db");
      await getLocalDb().delete();
    } catch {
      // Fall through to the raw API below. `getLocalDb` refuses to run when
      // IndexedDB is unusable, and that refusal is itself a reason the player
      // is looking at this screen.
    }
  }
  try {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(LOCAL_DB_NAME);
      // `deleteDatabase` blocks while any other tab holds the database open, so
      // it can neither succeed nor fail promptly. Resolution is the only
      // signal available, and a blocked delete must not strand the player on
      // the error screen.
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  } catch {
    // Nothing left to try; the reload below is still the better outcome than
    // leaving the player looking at the failure.
  }
  try {
    window.sessionStorage.clear();
  } catch {
    // Storage blocked entirely; the reload is unaffected.
  }
  window.location.reload();
}

/**
 * Class component because that is the only form React supports: error
 * boundaries cannot be function components, since there is no hook that
 * catches a descendant's render.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
    generation: 0,
    confirmingReset: false,
  };

  static getDerivedStateFromError(value: unknown): Partial<ErrorBoundaryState> {
    return { error: toError(value), confirmingReset: false };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Reported rather than swallowed: a caught error is still a bug, and
    // silencing it here would make this boundary the reason it never gets found.
    console.error("[ErrorBoundary] render failed", error, info.componentStack);
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error === null) return;
    if (!ErrorBoundary.didResetKeysChange(previous.resetKeys, this.props.resetKeys)) return;
    this.setState({ error: null, confirmingReset: false });
  }

  private static didResetKeysChange(
    previous: readonly unknown[] | undefined,
    next: readonly unknown[] | undefined
  ): boolean {
    if (previous === next) return false;
    if (!previous || !next) return true;
    if (previous.length !== next.length) return true;
    return previous.some((value, index) => !Object.is(value, next[index]));
  }

  private readonly reset = (): void => {
    this.setState((state) => ({ error: null, generation: state.generation + 1, confirmingReset: false }));
  };

  private readonly onResetLocalData = (): void => {
    // Two-step: the first click arms the action, the second performs it. This
    // button deletes every game on the device, and a single mis-tap on a phone
    // would be indistinguishable from the error itself.
    if (!this.state.confirmingReset) {
      this.setState({ confirmingReset: true });
      return;
    }
    void resetLocalData();
  };

  private readonly onCancelReset = (): void => {
    this.setState({ confirmingReset: false });
  };

  override render(): React.ReactNode {
    const { error, generation, confirmingReset } = this.state;
    const { children, fallback, fallbackTitle = "Something went wrong" } = this.props;

    if (error === null) {
      // The key is what makes `reset` a real retry: without it React reuses
      // the existing child fibers, a component that threw on mount stays
      // mounted in its failed state, and the same exception is simply raised
      // again one keystroke later.
      return (
        <React.Fragment key={generation}>
          {children}
        </React.Fragment>
      );
    }

    if (fallback) return <React.Fragment>{fallback(error, this.reset)}</React.Fragment>;

    return (
      <div
        role="alert"
        className="flex w-full flex-col items-start gap-4 border border-status-error/40 bg-status-error/5 p-6 text-board-dark"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-status-error">
            {fallbackTitle}
          </h2>
          <p className="text-sm text-board-muted">
            The rest of the app is still usable. You can try again, or clear this device&apos;s
            saved games if the problem is the saved data itself.
          </p>
        </div>

        <p className="max-w-prose break-words font-mono text-xs text-board-muted">{error.message}</p>

        {confirmingReset ? (
          <div
            role="alertdialog"
            aria-label="Confirm clearing local data"
            className="flex flex-col gap-3 border border-status-error/40 bg-board-light p-4"
          >
            <p className="text-sm text-board-dark">
              This permanently deletes every saved game and any move not yet uploaded from this
              device. It cannot be undone.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" size="sm" onClick={this.onResetLocalData}>
                Yes, delete my games
              </Button>
              <Button variant="secondary" size="sm" onClick={this.onCancelReset}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={this.reset}>
              Try again
            </Button>
            <Button variant="secondary" size="sm" onClick={this.onResetLocalData}>
              Reset local data
            </Button>
          </div>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
