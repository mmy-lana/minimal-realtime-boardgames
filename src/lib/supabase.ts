/**
 * Section 1.3 — Supabase client configuration.
 *
 * The realtime backend is optional by design: `offline_local` sessions never
 * touch it. Creating the client eagerly at module scope (and throwing on
 * missing configuration) would therefore break the whole app for users who
 * only play locally, so the configuration is validated *lazily* but
 * **mandatorily** — every entry point calls {@link getSupabaseClient}, which
 * refuses to hand out a half-configured client and throws a typed
 * {@link SupabaseConfigurationError} instead.
 *
 * UI surfaces should use {@link getSupabaseConfigError} to render an explicit
 * "realtime unavailable" state rather than crashing on import.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_ANON_KEY_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

export interface SupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
}

export class SupabaseConfigurationError extends Error {
  override readonly name = "SupabaseConfigurationError";
  readonly code = "SUPABASE_CONFIG_MISSING" as const;

  constructor(message: string) {
    super(message);
  }
}

function readEnv(name: string): string {
  const raw = process.env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

function isValidSupabaseUrl(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Returns the resolved configuration, or `null` with a human-readable reason.
 * Never throws, so it is safe to call during render.
 */
export function getSupabaseConfigError(): string | null {
  const url = readEnv(SUPABASE_URL_ENV);
  const anonKey = readEnv(SUPABASE_ANON_KEY_ENV);

  const problems: string[] = [];

  if (!url) {
    problems.push(`${SUPABASE_URL_ENV} is not set`);
  } else if (!isValidSupabaseUrl(url)) {
    problems.push(
      `${SUPABASE_URL_ENV} must be an absolute http(s) URL (received "${url}")`
    );
  }

  if (!anonKey) {
    problems.push(`${SUPABASE_ANON_KEY_ENV} is not set`);
  }

  if (problems.length === 0) return null;

  return `Realtime sync is not configured: ${problems.join("; ")}. Copy .env.example to .env.local and set both values.`;
}

/** `true` when both required environment variables are present and valid. */
export function isSupabaseConfigured(): boolean {
  return getSupabaseConfigError() === null;
}

/** Validates configuration and returns it, or throws a typed error. */
export function assertSupabaseConfigured(): SupabaseConfig {
  const error = getSupabaseConfigError();
  if (error !== null) {
    throw new SupabaseConfigurationError(error);
  }
  return {
    url: readEnv(SUPABASE_URL_ENV),
    anonKey: readEnv(SUPABASE_ANON_KEY_ENV),
  };
}

let clientSingleton: SupabaseClient | null = null;

/**
 * Returns the process-wide Supabase client, creating it on first use.
 * Throws {@link SupabaseConfigurationError} when configuration is missing.
 */
export function getSupabaseClient(): SupabaseClient {
  if (clientSingleton !== null) return clientSingleton;

  const { url, anonKey } = assertSupabaseConfigured();

  clientSingleton = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 30 },
    },
    global: {
      headers: { "x-application-name": "minimal-realtime-boardgames" },
    },
  });

  return clientSingleton;
}

/**
 * Drops the memoized client so the next {@link getSupabaseClient} call
 * re-reads the environment. Used after a reconnect or when credentials are
 * rotated at runtime.
 */
export function resetSupabaseClient(): void {
  clientSingleton = null;
}
