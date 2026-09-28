# Minimal Realtime Board Games

Zero-asset, offline-first turn-based board games powered by Next.js, Supabase Realtime, and IndexedDB.

- Live Demo: https://minimal-realtime-boardgames.vercel.app
- Repository: https://github.com/mmy-lana/minimal-realtime-boardgames

---

## Overview

A monochrome, high-density multiplayer game suite featuring six deterministic rulesets. It requires zero audio assets, no external icon libraries, and no client-side database UPDATE privileges.

Matches can be played locally on a single device or online via ephemeral URL invitations. Every action persists immediately to IndexedDB and synchronizes across clients with cryptographic seat authorization, conflict-resistant optimistic concurrency control, and deterministic history replay.

---

## Architecture Highlights

- Client-Authoritative Replay Integrity Gate: Clients never blindly accept remote board snapshots. Every incoming move is replayed from ply 1 through deterministic micro-engines. Discrepancies halt play into an explicit conflict state.
- Append-Only PostgreSQL Move Ledger: Room resets advance an epoch counter rather than deleting historical rows, preserving an immutable audit log across matches.
- Zero UPDATE Policies: All remote state mutations are gated behind `SECURITY DEFINER` PostgreSQL functions enforcing turn ownership, OCC version matching, and payload bounds.
- Offline-First Write-Through Storage: Mutations commit to local IndexedDB via Dexie before reaching the wire. Unsent moves queue automatically and drain with exponential backoff on reconnection.
- Procedural Audio Engine: Dynamic sound effects synthesized directly in-browser via the Web Audio API with zero external media files.

---

## Implemented Games

| Game | Grid Size | Mechanic & Ruleset Features | Win Condition |
| :--- | :--- | :--- | :--- |
| Tic-Tac-Toe | 3 x 3 | 3-mark vanishing rule (4th mark lifts oldest mark) | 3-in-a-row (No draws) |
| Connect Four | 7 x 6 | Column gravity drop with landing slot preview | 4-in-a-row |
| Gomoku | 15 x 15 | Intersection placement with snapping and hoshi marks | 5-in-a-row |
| Reversi | 8 x 8 | Multi-directional flanking flips with pass tracking | Majority disc count |
| Checkers | 8 x 8 | Mandatory capture priority, jump midpoints, crowning | Elimination or stalemate |
| Hex | 7 x 7 | Rhombic topology with 6-directional breadth-first flood | Unbroken edge connection |

---

## Technical Stack

- Frontend: Next.js (App Router), React, TypeScript
- Styling: Tailwind CSS v4 (Custom theme tokens, hairline borders, zero-layout-shift focus rings)
- Persistence: IndexedDB via Dexie.js (`dexie-react-hooks`)
- Realtime & Backend: Supabase (PostgreSQL, Row-Level Security, Realtime broadcast channels)
- Audio: Web Audio API (Synthesized sine and triangle wave envelopes)
- Testing: Vitest, jsdom, `@testing-library/react`, `fake-indexeddb`

---

## Security & Concurrency Model

### 1. Database Privilege Hardening
Direct `UPDATE` operations on `game_rooms` and direct `INSERT` operations on `game_moves` are prohibited by Row-Level Security. State mutations funnel through three PostgreSQL functions:
- `submit_turn_move`: Enforces token validity, turn order, version matching, and game-specific turn passing.
- `join_room`: Atomically claims open seats and prevents duplicate assignments.
- `submit_terminal_update`: Manages legitimate resignations and epoch-advancing match resets.

### 2. Optimistic Concurrency Control (OCC)
Each room contains a monotonic `version` integer. When concurrent moves collide:
1. The server rejects stale writes with `version_conflict`.
2. The client pauses execution using exponential backoff: `delay = 300ms * 2^retryCount`.
3. The client fetches the remote version and turn state into local storage.
4. The transaction retries without re-prompting the user.

### 3. Replay Verification Gate
When joining or reconnecting to an active game:
1. The client queries the room's current `reset_epoch` and loads all associated moves.
2. The engine executes the complete sequence from the initial board state.
3. The recomputed state is compared against `game_rooms.board_snapshot`.
4. Play unlocks only when states match. Any divergence locks inputs and triggers a reconciliation dialog.

---

## Local Development

### Prerequisites
- Node.js 20+
- pnpm / npm / yarn
- Supabase CLI or hosted Supabase project

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/mmy-lana/minimal-realtime-boardgames.git
   cd minimal-realtime-boardgames
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env.local
   ```
   Add your Supabase project parameters:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

4. Apply the database schema:
   Execute the migration SQL file in the Supabase SQL Editor:
   ```bash
   supabase/schema.sql
   ```

5. Run the local development server:
   ```bash
   npm run dev
   ```
   Access the application at `http://localhost:3000`.

---

## Verification & Testing

The project maintains comprehensive unit, integration, and security audit suites:

```bash
# Run complete test suite
npm test

# Type check TypeScript definitions
npm run typecheck

# Lint source files
npm run lint

# Build production bundle
npm run build
```

Key test suites:
- `tests/schema-audit.test.ts`: Verifies append-only invariants, turn-pass whitelisting, and SQL grant revocations.
- `tests/realtime-epoch.test.ts`: Asserts move isolation across match reset epochs.
- `tests/sync.test.ts`: Tests write-through Dexie transactions, retry backoff, and OCC recovery.
- `tests/engines.test.ts`: Validates deterministic game rules, edge alignments, and topological win paths.
