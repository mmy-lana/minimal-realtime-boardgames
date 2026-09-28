/**
 * SEC-AUDIT-01 — the migration file must never destroy the audit trail again.
 *
 * `submit_terminal_update` used to answer `p_clear_history` by running
 * `delete from public.game_moves where room_id = p_room_id`. That single
 * statement is the defect this file exists to prevent, and nothing in the
 * repository would have caught its return: there is no Postgres in CI, so the
 * migration is applied by hand and read by eye.
 *
 * These assertions are textual rather than executable, and that is a real
 * limitation worth stating. They cannot prove the SQL is valid or that the
 * function behaves as described on a live database. What they do is pin the
 * specific property that was violated — that no code path in this file can
 * remove a recorded move — and they fail loudly if the destructive statement
 * ever comes back, which is the realistic way this regresses.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(new URL("../supabase/schema.sql", import.meta.url));
const schema = readFileSync(schemaPath, "utf8");

/** The body of one `create or replace function`, from its signature to its `$$;`. */
function functionBody(name: string): string {
  const start = schema.indexOf(`create or replace function public.${name}(`);
  expect(start, `public.${name} is not defined in schema.sql`).toBeGreaterThan(-1);
  const end = schema.indexOf("$$;", start);
  expect(end, `public.${name} has no terminating $$;`).toBeGreaterThan(start);
  return schema.slice(start, end);
}

describe("SEC-AUDIT-01: the move log is append-only", () => {
  it("contains no statement that deletes recorded moves", () => {
    // The point of the file, stated as the absence of the thing that broke it.
    // Scoped to the two statements that would actually destroy history; the
    // `drop index` and `drop policy` statements are schema changes, not data
    // loss, and the cascade on room deletion is a separate, deliberate
    // erasure path that is not spelled as a delete.
    expect(schema).not.toMatch(/delete\s+from\s+(public\.)?game_moves/i);
  });

  it("advances the room epoch instead of clearing the log", () => {
    const body = functionBody("submit_terminal_update");
    expect(body).toMatch(/reset_epoch\s*=\s*case/);
    expect(body).toMatch(/when\s+p_clear_history\s+then\s+v_room\.reset_epoch\s*\+\s*1/);
    expect(body).toMatch(/else\s+v_room\.reset_epoch/);
  });

  it("stamps every new move with the epoch it was played in", () => {
    const body = functionBody("submit_turn_move");
    expect(body).toMatch(
      /insert into public\.game_moves \(id, room_id, epoch, ply,[\s\S]*?\)\s*values \(\s*p_move_id, p_room_id, v_room\.reset_epoch, p_ply,/
    );
  });
});

describe("SEC-AUDIT-01: the epoch is a real, persisted part of the schema", () => {
  it("declares both columns as non-null with a zero default", () => {
    expect(schema).toMatch(/reset_epoch\s+integer\s+not null\s+default\s+0/);
    expect(schema).toMatch(/^\s*epoch\s+integer\s+not null\s+default\s+0/m);
  });

  it("migrates a database that was created before the columns existed", () => {
    // `create table if not exists` leaves an existing table alone, so without
    // these the columns would be missing on every deployment that predates
    // this change and every query against them would fail at runtime.
    expect(schema).toMatch(
      /alter table public\.game_rooms add column if not exists reset_epoch integer not null default 0/
    );
    expect(schema).toMatch(
      /alter table public\.game_moves add column if not exists epoch integer not null default 0/
    );
  });

  it("indexes the log by room, epoch and ply", () => {
    // A room's ply numbering restarts after a reset, so `(room_id, ply)` is no
    // longer unique within a room and an index that ignores the epoch would
    // merge two different games' moves.
    expect(schema).toMatch(
      /create index if not exists game_moves_room_epoch_ply_idx on public\.game_moves \(room_id, epoch, ply\)/
    );
    expect(schema).toMatch(/drop index if exists public\.game_moves_room_ply_idx/);
  });

  it("guards both epoch columns against a negative value", () => {
    expect(schema).toMatch(/game_rooms_reset_epoch_non_negative check \(reset_epoch >= 0\)/);
    expect(schema).toMatch(/game_moves_epoch_non_negative check \(epoch >= 0\)/);
    // The constraints are also added to an already-deployed table, behind
    // duplicate_object guards, because `add constraint` has no if-not-exists.
    expect(schema).toMatch(
      /add constraint game_rooms_reset_epoch_non_negative[\s\S]*?exception when duplicate_object then null/
    );
    expect(schema).toMatch(
      /add constraint game_moves_epoch_non_negative[\s\S]*?exception when duplicate_object then null/
    );
  });

  it("keeps the SECURITY DEFINER grants aligned with the signatures", () => {
    // The grant statements name a function by its full argument-type list, so
    // a parameter added to a definition without a matching edit to the grants
    // leaves a *different* function signature unrevoked — still executable by
    // PUBLIC, still running as the migration role. Nothing in the app would
    // reveal that, so it is checked here against the parsed definitions.
    for (const name of ["submit_turn_move", "join_room", "submit_terminal_update"]) {
      const types = argumentTypes(name)
        .map((type) => type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(", ");

      expect(schema, `${name} is not revoked from PUBLIC`).toMatch(
        new RegExp(`revoke execute on function public\\.${name}\\(${types}\\) from public;`)
      );
      expect(schema, `${name} is not granted to the two browser roles`).toMatch(
        new RegExp(`grant execute on function public\\.${name}\\(${types}\\) to anon, authenticated;`)
      );
    }
  });
});

/** The argument types of a function definition, in order, as grants spell them. */
function argumentTypes(name: string): string[] {
  const marker = `create or replace function public.${name}(`;
  const start = schema.indexOf(marker);
  expect(start, `public.${name} is not defined in schema.sql`).toBeGreaterThan(-1);

  const rest = schema.slice(start + marker.length);
  const end = rest.indexOf(")");
  expect(end, `public.${name} has an unterminated parameter list`).toBeGreaterThan(-1);

  // A parameter may carry a line comment above it explaining a default, and a
  // comment can contain commas, so they are removed before the list is split.
  const withoutComments = rest
    .slice(0, end)
    .split("\n")
    .map((line) => (line.trimStart().startsWith("--") ? "" : line))
    .join("\n");

  return withoutComments
    .split(",")
    .map((param) => param.trim())
    .filter((param) => param.length > 0)
    .map((param) => {
      // Drop the parameter name and any `default ...` clause.
      const type = param.replace(/^\s*\w+\s+/, "").replace(/\s+default\b[\s\S]*$/, "").trim();
      expect(type, `could not read the type of a ${name} parameter from "${param}"`).not.toBe("");
      return type;
    });
}
