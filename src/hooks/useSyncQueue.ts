"use client";

/**
 * Section 2.1 names this file `useSyncQueue.ts`; plan item 4.3.3 describes the
 * same module as `useOfflineSync`. It owns the write-through half of the
 * offline-first story: it keeps a live count of undrained queue items, triggers
 * a drain whenever connectivity returns, and retries with backoff for as long
 * as the tab is open.
 *
 * The queue itself is deliberately *not* state this hook duplicates. It is a
 * Dexie table, and `useLiveQuery` reads it directly, so a drain performed by a
 * different tab or by a background flush is reflected here without any
 * cross-tab messaging.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { countPendingSyncItems, isLocalDbAvailable } from "@/lib/db";
import { flushSyncQueue, isBrowserOffline, type FlushSummary } from "@/lib/sync";
import { useNetworkStatus } from "./useNetworkStatus";

/** Backoff schedule in milliseconds, indexed by consecutive failed attempts. */
const RETRY_DELAYS_MS = [1_000, 4_000, 10_000, 30_000] as const;

/** Above this depth the queue is only drained on an explicit request. */
const AUTO_DRAIN_LIMIT = 50;

export interface UseSyncQueueOptions {
  /**
   * Drains automatically when items appear or connectivity returns. Off by
   * default so a local-only session never reaches for the network.
   */
  readonly autoDrain?: boolean;
  /** Disables draining entirely, e.g. while a conflict dialog is open. */
  readonly paused?: boolean;
}

export interface UseSyncQueueResult {
  /** Live count of queue rows that have not been accepted by the server. */
  readonly pendingCount: number;
  /** True while a drain is on the wire right now. */
  readonly isFlushing: boolean;
  /** Consecutive failed drains, reset on any success. */
  readonly failedAttempts: number;
  /** The summary of the most recent drain, or null before the first one. */
  readonly lastSummary: FlushSummary | null;
  /** Message from the most recent failure, or null if the last drain worked. */
  readonly lastError: string | null;
  /** Runs one drain now and resolves with the summary. */
  readonly flushNow: () => Promise<FlushSummary | null>;
  /** Clears the backoff so the next automatic attempt happens immediately. */
  readonly reset: () => void;
}

export function useSyncQueue(options: UseSyncQueueOptions = {}): UseSyncQueueResult {
  const { autoDrain = false, paused = false } = options;
  const { isOnline } = useNetworkStatus();

  const available = isLocalDbAvailable();
  const pendingCount = useLiveQuery(
    async () => {
      if (!available) return 0;
      try {
        return await countPendingSyncItems();
      } catch {
        // A blocked IndexedDB (private mode, disabled storage) reads as empty
        // rather than crashing the session that owns this hook.
        return 0;
      }
    },
    [available],
    0
  );

  const [isFlushing, setIsFlushing] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lastSummary, setLastSummary] = useState<FlushSummary | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const flushingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedAttemptsRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const flushNow = useCallback(async (): Promise<FlushSummary | null> => {
    // A drain already on the wire owns the queue; a second one would race it.
    if (flushingRef.current) return null;
    if (isBrowserOffline()) {
      setLastError("The device is offline, so queued changes are still waiting.");
      return null;
    }

    flushingRef.current = true;
    if (mountedRef.current) setIsFlushing(true);
    try {
      const summary = await flushSyncQueue();
      failedAttemptsRef.current = 0;
      if (mountedRef.current) {
        setFailedAttempts(0);
        setLastSummary(summary);
        // A drain that made no progress at all is the only kind worth telling
        // the player about; partial progress is already visible as the count.
        setLastError(
          summary.succeeded === 0 && summary.attempted > 0
            ? summary.conflictDetected
              ? "A queued move conflicts with the server copy, so play is paused."
              : "Some queued changes could not be sent."
            : null
        );
      }
      return summary;
    } catch (error) {
      failedAttemptsRef.current += 1;
      if (mountedRef.current) {
        setFailedAttempts(failedAttemptsRef.current);
        setLastError(error instanceof Error ? error.message : "The queued changes could not be sent.");
      }
      return null;
    } finally {
      flushingRef.current = false;
      if (mountedRef.current) setIsFlushing(false);
    }
  }, []);

  const reset = useCallback(() => {
    failedAttemptsRef.current = 0;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (mountedRef.current) {
      setFailedAttempts(0);
      setLastError(null);
    }
  }, []);

  // Retry with backoff while a drain keeps failing and the tab stays open.
  useEffect(() => {
    if (!autoDrain || paused || !isOnline) return;
    if (failedAttempts === 0) return;

    const delay =
      RETRY_DELAYS_MS[Math.min(failedAttempts - 1, RETRY_DELAYS_MS.length - 1)] ??
      RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    timerRef.current = setTimeout(() => {
      void flushNow();
    }, delay);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [autoDrain, paused, isOnline, failedAttempts, flushNow]);

  // Drain as soon as there is something to send and a way to send it.
  useEffect(() => {
    if (!autoDrain || paused || !isOnline) return;
    if (pendingCount === 0) return;
    if (pendingCount > AUTO_DRAIN_LIMIT) return;
    void flushNow();
  }, [autoDrain, paused, isOnline, pendingCount, flushNow]);

  // Reconnect is the single most important trigger: the queue is otherwise
  // idle, and this is the moment the user expects it to catch up.
  useEffect(() => {
    if (!autoDrain || paused) return;
    if (!isOnline) return;
    if (pendingCount === 0) return;
    reset();
    void flushNow();
  }, [isOnline, autoDrain, paused, pendingCount, reset, flushNow]);

  return {
    pendingCount,
    isFlushing,
    failedAttempts,
    lastSummary,
    lastError,
    flushNow,
    reset,
  };
}
