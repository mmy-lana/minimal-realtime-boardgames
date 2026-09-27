/**
 * Vitest global setup.
 *
 * `fake-indexeddb/auto` installs a spec-compliant IndexedDB implementation so
 * the Dexie-backed storage and sync-queue suites exercise the real code path
 * rather than a hand-written stub. jsdom already ships its own
 * `indexedDB`-less globals, which is why the UI suites get a fresh database
 * per test file via the exported helper below.
 */
import "fake-indexeddb/auto";
