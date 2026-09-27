"use client";

/**
 * Section 2.1 / 4.3 — Browser connectivity.
 *
 * `navigator.onLine` is necessary but not sufficient: a laptop on a captive
 * portal or a dead Wi-Fi link frequently reports itself as online. This hook
 * therefore treats the browser events as the fast signal and an explicit
 * reachability probe as the slow confirmation, so the indicator only claims
 * "online" once something has actually answered.
 *
 * The probe is deliberately cheap (a HEAD request to the app's own origin)
 * and is never run while the browser already reports offline.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** How the hook currently believes the device is connected. */
export type NetworkStatus = "online" | "offline" | "checking";

export interface UseNetworkStatusOptions {
  /**
   * Probes the origin after a browser `online` event to confirm reachability.
   * On by default; a caller that only wants the raw browser flag can opt out.
   */
  readonly probeOnReconnect?: boolean;
  /** Milliseconds to wait for a probe to answer before trusting the browser. */
  readonly probeTimeoutMs?: number;
}

export interface UseNetworkStatusResult {
  /** True only when the browser says online *and* a probe confirmed it. */
  readonly isOnline: boolean;
  /** The browser's own `navigator.onLine`, unfiltered. */
  readonly browserOnline: boolean;
  /** `checking` while a probe is in flight after reconnecting. */
  readonly status: NetworkStatus;
  /** Re-runs the probe immediately; resolves to the confirmed result. */
  readonly recheck: () => Promise<boolean>;
  /** Timestamp of the last confirmed transition, or null if never confirmed. */
  readonly lastChangedAt: number | null;
}

function readBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function useNetworkStatus(options: UseNetworkStatusOptions = {}): UseNetworkStatusResult {
  const { probeOnReconnect = true, probeTimeoutMs = 4000 } = options;

  const [browserOnline, setBrowserOnline] = useState<boolean>(readBrowserOnline);
  const [probeResult, setProbeResult] = useState<boolean | null>(null);
  const [status, setStatus] = useState<NetworkStatus>(() =>
    readBrowserOnline() ? "online" : "offline"
  );
  const [lastChangedAt, setLastChangedAt] = useState<number | null>(null);

  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const recheck = useCallback(async (): Promise<boolean> => {
    if (typeof navigator === "undefined") return true;
    if (!navigator.onLine) {
      if (mountedRef.current) {
        setStatus("offline");
        setProbeResult(false);
        setLastChangedAt(Date.now());
      }
      return false;
    }
    if (!probeOnReconnect || typeof fetch !== "function") {
      if (mountedRef.current) setStatus("online");
      return true;
    }

    if (mountedRef.current) setStatus("checking");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), probeTimeoutMs);

    let reachable = false;
    try {
      // Same-origin, no body, no cache: the response code itself is the answer.
      const response = await fetch(location.href, {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal,
      });
      reachable = response.ok || response.status === 405;
    } catch {
      reachable = false;
    } finally {
      clearTimeout(timer);
    }

    if (!mountedRef.current || controller.signal.aborted) return reachable;
    setProbeResult(reachable);
    setStatus(reachable ? "online" : "offline");
    if (!reachable) setLastChangedAt(Date.now());
    return reachable;
  }, [probeOnReconnect, probeTimeoutMs]);

  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
      if (!probeOnReconnect) {
        setStatus("online");
        return;
      }
      void recheck();
    };

    const handleOffline = () => {
      setBrowserOnline(false);
      setProbeResult(false);
      setStatus("offline");
      setLastChangedAt(Date.now());
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [probeOnReconnect, recheck]);

  // The browser can come back online without firing the event while the tab was
  // frozen, so visibility is a cheap second trigger for the probe.
  useEffect(() => {
    if (!probeOnReconnect) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !navigator.onLine) {
        setStatus("offline");
        return;
      }
      if (document.visibilityState === "visible" && status === "offline" && probeResult === false) {
        void recheck();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [probeOnReconnect, status, probeResult, recheck]);

  const isOnline = status === "online" && browserOnline;

  return { isOnline, browserOnline, status, recheck, lastChangedAt };
}
