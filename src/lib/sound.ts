/**
 * Section 4.5 — Synthesised sound effects.
 *
 * Every cue is generated with the Web Audio API at call time: there is not a
 * single audio file in this project, so nothing to preload, nothing to fail to
 * fetch, and no licensing question. A move is a short decaying sine ping, a
 * capture is a two-note fall, and the terminal cues are longer.
 *
 * The `AudioContext` is created lazily on the first cue. Browsers refuse to
 * start one before a user gesture, so the first call is expected to be in
 * response to a tap; if construction fails the caller is not disturbed —
 * `playCue` simply does nothing and the game stays fully usable.
 */

import { useCallback, useEffect, useRef } from "react";

/** The closed set of cues the interface can emit. */
export type SoundCue =
  | "move"
  | "capture"
  | "invalid"
  | "win"
  | "lose"
  | "draw"
  | "sync"
  | "offline";

interface ToneSpec {
  /** Frequencies played in order, one after another. */
  readonly frequencies: readonly number[];
  /** Seconds each frequency holds before the next begins. */
  readonly stepSeconds: number;
  /** Peak gain at the start of each tone, ramped to silence at its end. */
  readonly peak: number;
  readonly type: OscillatorType;
}

const CUE_SPECS: Readonly<Record<SoundCue, ToneSpec>> = {
  // A single quiet blip — the common case, one stone or one disc.
  move: { frequencies: [520], stepSeconds: 0.08, peak: 0.06, type: "sine" },
  // A falling pair, so a capture reads as heavier than a quiet move.
  capture: { frequencies: [660, 440], stepSeconds: 0.09, peak: 0.08, type: "triangle" },
  // Two low stacked tones: unmistakably a refusal.
  invalid: { frequencies: [180, 150], stepSeconds: 0.1, peak: 0.07, type: "square" },
  win: { frequencies: [523, 659, 784, 1047], stepSeconds: 0.11, peak: 0.09, type: "sine" },
  lose: { frequencies: [440, 349, 262], stepSeconds: 0.13, peak: 0.08, type: "sine" },
  draw: { frequencies: [392, 392], stepSeconds: 0.16, peak: 0.07, type: "sine" },
  // Short and neutral: this fires on connectivity, not on play.
  sync: { frequencies: [880], stepSeconds: 0.05, peak: 0.05, type: "sine" },
  offline: { frequencies: [330, 247], stepSeconds: 0.1, peak: 0.06, type: "triangle" },
};

/** Cues that may fire while a match is already running. */
const RATE_LIMITED_CUES: ReadonlySet<SoundCue> = new Set(["move", "capture", "sync", "offline"]);

const MIN_INTERVAL_MS = 40;

let sharedContext: AudioContext | null = null;
/** `false` once a construction attempt has failed, so we never retry. */
let contextUnavailable = false;

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function getSharedContext(): AudioContext | null {
  if (contextUnavailable) return null;
  if (sharedContext) return sharedContext;

  const Constructor = getAudioContextConstructor();
  if (!Constructor) {
    contextUnavailable = true;
    return null;
  }
  try {
    sharedContext = new Constructor();
  } catch {
    contextUnavailable = true;
    sharedContext = null;
  }
  return sharedContext;
}

/**
 * Suspends and releases the shared context. Called when the last consumer
 * unmounts so a long-lived tab is not holding an audio device awake.
 */
export function releaseAudioContext(): void {
  const context = sharedContext;
  sharedContext = null;
  if (!context) return;
  void context.close().catch(() => {
    // A context that refuses to close is already unusable; nothing to do.
  });
}

/**
 * Plays one cue. Safe to call from anywhere: on the server, before a user
 * gesture, or in a browser without Web Audio it is a no-op rather than a throw.
 */
export function playCue(cue: SoundCue, options: { now?: number } = {}): void {
  const spec = CUE_SPECS[cue];
  const context = getSharedContext();
  if (!context) return;

  try {
    if (context.state === "suspended") {
      void context.resume().catch(() => {
        // Resuming is best-effort; the tone below simply will not be heard.
      });
    }

    let startAt = options.now ?? context.currentTime;
    for (const frequency of spec.frequencies) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = spec.type;
      oscillator.frequency.setValueAtTime(frequency, startAt);

      // A short attack then an exponential tail: a percussive shape rather
      // than a beep that starts and stops abruptly.
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(spec.peak, startAt + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + spec.stepSeconds);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + spec.stepSeconds + 0.01);

      startAt += spec.stepSeconds;
    }
  } catch {
    // A scheduling failure must never break the move that triggered the cue.
  }
}

export interface UseSoundOptions {
  /** Disables every cue without unmounting the hook. */
  readonly enabled?: boolean;
  /** Cues to suppress entirely, e.g. while a modal is open. */
  readonly muted?: ReadonlySet<SoundCue>;
}

/**
 * Returns a stable `play` callback plus a throttled `playThrottled` for the
 * high-frequency cues, so a fast double-tap cannot stack overlapping tones.
 */
export function useSound(options: UseSoundOptions = {}): {
  play: (cue: SoundCue) => void;
  playThrottled: (cue: SoundCue) => void;
  isSupported: boolean;
} {
  const { enabled = true, muted } = options;
  const enabledRef = useRef(enabled);
  const mutedRef = useRef(muted);
  const lastPlayedRef = useRef(new Map<SoundCue, number>());

  enabledRef.current = enabled;
  mutedRef.current = muted;

  useEffect(() => {
    return () => {
      releaseAudioContext();
    };
  }, []);

  const play = useCallback((cue: SoundCue) => {
    if (!enabledRef.current) return;
    if (mutedRef.current?.has(cue)) return;
    playCue(cue);
  }, []);

  const playThrottled = useCallback((cue: SoundCue) => {
    if (!enabledRef.current) return;
    if (mutedRef.current?.has(cue)) return;
    if (!RATE_LIMITED_CUES.has(cue)) {
      playCue(cue);
      return;
    }
    const now = Date.now();
    const last = lastPlayedRef.current.get(cue);
    if (last !== undefined && now - last < MIN_INTERVAL_MS) return;
    lastPlayedRef.current.set(cue, now);
    playCue(cue);
  }, []);

  return {
    play,
    playThrottled,
    isSupported: getAudioContextConstructor() !== null && typeof window !== "undefined",
  };
}
