/**
 * Section 1.4 — Base utilities.
 *
 * Framework-free helpers shared by the engine, the storage layer, the sync
 * queue and every React component. Nothing here touches the network or the
 * filesystem, so the module is safe to import from any runtime.
 */

/* -------------------------------------------------------------------------- */
/* Class names                                                                */
/* -------------------------------------------------------------------------- */

export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | { [className: string]: boolean | null | undefined };

/**
 * Minimal, dependency-free `classnames` implementation.
 *
 * Deliberately avoids `clsx` / `tailwind-merge`: the design system is built
 * from static Tailwind v4 utilities, so conditional composition is all that
 * is required and the bundle stays at zero extra kilobytes.
 */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  collectClassNames(values, out);
  return out.join(" ");
}

function collectClassNames(value: ClassValue, out: string[]): void {
  if (!value && value !== 0) return;
  if (typeof value === "string" || typeof value === "number") {
    const trimmed = String(value).trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectClassNames(entry, out);
    return;
  }
  for (const [className, enabled] of Object.entries(value)) {
    if (enabled) out.push(className);
  }
}

/* -------------------------------------------------------------------------- */
/* Identifiers & seat tokens                                                  */
/* -------------------------------------------------------------------------- */

const HEX_DIGITS = "0123456789abcdef";

function fillRandomBytes(target: Uint8Array): Uint8Array {
  const cryptoRef: Crypto | undefined =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;

  if (cryptoRef && typeof cryptoRef.getRandomValues === "function") {
    cryptoRef.getRandomValues(target);
    return target;
  }
  for (let i = 0; i < target.length; i += 1) {
    target[i] = Math.floor(Math.random() * 256);
  }
  return target;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i]! & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * RFC 4122 v4 identifier built on `crypto.randomUUID`, with a
 * `crypto.getRandomValues` fallback for non-secure contexts and a final
 * `Math.random` fallback so identifiers can never throw during SSR.
 */
export function createId(): string {
  const cryptoRef: Crypto | undefined =
    typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;

  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }

  const bytes = fillRandomBytes(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return toHex(bytes);
}

/**
 * Opaque seat token stored in `game_rooms.player_*_token` and presented by the
 * SECURITY DEFINER RPCs for authorization. 128 bits of entropy, hex encoded.
 */
export function createSeatToken(byteLength = 16): string {
  const size = Math.max(8, Math.floor(byteLength));
  return toHex(fillRandomBytes(new Uint8Array(size)));
}

/* -------------------------------------------------------------------------- */
/* Coordinates formatting                                                     */
/* -------------------------------------------------------------------------- */

/** Grid-agnostic notation, e.g. `formatCoordinate(3, 4)` -> `"3,4"`. */
export function formatCoordinate(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Generalised grid notation for every board that is not 8x8-specific, used by
 * Tic-Tac-Toe, Gomoku, Reversi, Checkers and Hex. Files run `A`..`Z` left to
 * right and ranks count up from the bottom row, so
 * `formatGridSquare(1, 0, 15)` -> `"B15"`.
 */
export function formatGridSquare(x: number, y: number, size: number): string {
  const file = x >= 0 && x < 26 ? String.fromCharCode(65 + x) : String(x);
  const rank = size - y;
  return `${file}${rank >= 1 ? rank : 0}`;
}

/* -------------------------------------------------------------------------- */
/* Time                                                                       */
/* -------------------------------------------------------------------------- */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Compact relative time for sync badges and history rows.
 * Deterministic when `now` is supplied, which keeps render output testable.
 */
export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now(),
  fallback = "unknown"
): string {
  if (!Number.isFinite(timestamp)) return fallback;

  const deltaMs = now - timestamp;
  const future = deltaMs < 0;
  const absMs = Math.abs(deltaMs);

  if (absMs < 5_000) return "just now";

  let value: string;
  if (absMs < MINUTE_MS) {
    value = `${Math.floor(absMs / 1000)}s`;
  } else if (absMs < HOUR_MS) {
    value = `${Math.floor(absMs / MINUTE_MS)}m`;
  } else if (absMs < DAY_MS) {
    value = `${Math.floor(absMs / HOUR_MS)}h`;
  } else {
    value = `${Math.floor(absMs / DAY_MS)}d`;
  }

  return future ? `in ${value}` : `${value} ago`;
}

/** Absolute wall-clock time in the viewer's locale, for tooltips and titles. */
export function formatClockTime(timestamp: number, locale?: string): string {
  if (!Number.isFinite(timestamp)) return "unknown";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

interface StructuredErrorLike {
  message?: unknown;
  code?: unknown;
  hint?: unknown;
}

/**
 * Normalizes any thrown value into a human-readable string for error and
 * empty states. Handles `Error`, Supabase `PostgrestError`-shaped objects,
 * plain strings, and JSON-serializable payloads.
 */
export function describeError(
  error: unknown,
  fallback = "An unexpected error occurred."
): string {
  if (error === null || error === undefined) return fallback;

  if (typeof error === "string") {
    const trimmed = error.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  if (error instanceof Error) {
    const structured = error as Error & StructuredErrorLike;
    const code = typeof structured.code === "string" ? structured.code.trim() : "";
    const message = error.message.trim();
    const base = message.length > 0 ? message : fallback;
    return code.length > 0 ? `${base} (${code})` : base;
  }

  if (typeof error === "object") {
    const structured = error as StructuredErrorLike;
    const parts: string[] = [];
    if (typeof structured.message === "string" && structured.message.trim()) {
      parts.push(structured.message.trim());
    }
    if (typeof structured.code === "string" && structured.code.trim()) {
      parts.push(`(${structured.code.trim()})`);
    }
    if (typeof structured.hint === "string" && structured.hint.trim()) {
      parts.push(structured.hint.trim());
    }
    if (parts.length > 0) return parts.join(" ");

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Circular or otherwise non-serializable payload: fall through.
    }
  }

  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
