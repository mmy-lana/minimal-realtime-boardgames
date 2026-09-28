-- =============================================================================
-- Minimal Realtime Board Games — remote schema
-- =============================================================================
-- TRUST MODEL & VALIDATION BOUNDARY
--
--   * public.game_rooms intentionally exposes NO client-side UPDATE policy.
--     Every mutation of an existing room must funnel through a SECURITY
--     DEFINER RPC. This keeps room lifecycle, seat authorization, turn order
--     and optimistic-concurrency (OCC) version locking inside PostgreSQL,
--     where it cannot be bypassed by a crafted request.
--
--   * Board *rule* validation is client-authoritative. The RPCs verify who is
--     moving and whether the move is admissible for the seat/turn, but not
--     whether the resulting board obeys the rules of the game. Receiving
--     clients therefore re-derive state from engine/rules/*.ts on
--     game_moves Realtime inserts, and replay the full history on load or
--     reconnect to verify room snapshot integrity. Divergence sets the local
--     session's syncState to 'conflict', which halts play and raises the
--     invalid-state dialog.
--
-- Apply with:  psql "$SUPABASE_DB_URL" -f supabase/schema.sql
-- Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.game_kind as enum ('tictactoe', 'connect4', 'gomoku', 'reversi', 'checkers', 'hex');
exception when duplicate_object then null; end $$;

-- A deployment that already has the enum still holds the old 'chess' label.
-- Renaming the value in place is the only migration that keeps the rooms
-- already stored in `game_rooms` readable: the rows keep the same ordinal,
-- and no `update ... set game_kind = 'hex'` is needed (or possible, since the
-- new label does not exist until this statement has run).
--
-- Three outcomes, all of them "already correct" for a re-run:
--   * fresh install  -> 'chess' is absent      -> undefined_object
--   * migrated       -> 'hex' present, no 'chess' -> undefined_object
--   * mid-migration  -> both present           -> the rename runs
do $$ begin
  alter type public.game_kind rename value 'chess' to 'hex';
exception
  when undefined_object then null;
  when duplicate_object then null;
  when syntax_error then null;
end $$;

-- Belt and braces for a database where the enum was hand-edited and ended up
-- with neither label, and for PostgreSQL < 10 where ALTER TYPE ... RENAME VALUE
-- does not exist at all (there it reports undefined_object via its wrapper).
do $$ begin
  alter type public.game_kind add value if not exists 'hex';
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.match_status as enum ('waiting', 'active', 'draw', 'won_black', 'won_white', 'abandoned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.player_color as enum ('black', 'white');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  game_kind public.game_kind not null,
  status public.match_status not null default 'waiting',
  player_black_token text not null,
  player_white_token text null,
  current_turn public.player_color not null default 'black',
  turn_number integer not null default 1,
  board_snapshot jsonb not null,
  winner public.player_color null,
  version integer not null default 1,
  reset_epoch integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_rooms_version_positive check (version > 0),
  constraint game_rooms_turn_number_positive check (turn_number > 0),
  constraint game_rooms_reset_epoch_non_negative check (reset_epoch >= 0)
);

comment on table public.game_rooms is
  'Authoritative room state. All post-insert mutations go through SECURITY DEFINER RPCs.';

comment on column public.game_rooms.reset_epoch is
  'Increments on every RESET. Moves are stamped with the epoch that was current when they were played, so a reset starts a new move log without destroying the old one.';

create table if not exists public.game_moves (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  epoch integer not null default 0,
  ply integer not null,
  player public.player_color not null,
  from_coord jsonb null,
  to_coord jsonb not null,
  payload text null,
  created_at timestamptz not null default now(),
  constraint game_moves_ply_positive check (ply > 0),
  constraint game_moves_epoch_non_negative check (epoch >= 0)
);

comment on column public.game_moves.epoch is
  'The room reset_epoch in force when this move was played. Ply numbering restarts at 1 after a reset, so (room_id, epoch, ply) is the identity of a move; epoch alone is what separates one game from its successors.';

-- A RESET must be able to start a fresh move log without deleting the previous
-- one: the moves before it are the evidence of what happened in the game that
-- was abandoned or resigned, and destroying them destroys the only record.
--
-- `create table if not exists` does not add a column to a table that already
-- exists, so an already-deployed database needs the columns and their
-- constraints applied explicitly. Defaults backfill existing rows to epoch 0,
-- which is correct: every move already stored predates the first reset.
alter table public.game_rooms add column if not exists reset_epoch integer not null default 0;
alter table public.game_moves add column if not exists epoch integer not null default 0;

do $$ begin
  alter table public.game_rooms add constraint game_rooms_reset_epoch_non_negative check (reset_epoch >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.game_moves add constraint game_moves_epoch_non_negative check (epoch >= 0);
exception when duplicate_object then null; end $$;

-- Full-history replay on load/reconnect reads by (room_id, epoch, ply). This
-- replaces the (room_id, ply) index: a room's ply numbering restarts after a
-- reset, so ply alone is not unique within a room and an index that ignores
-- the epoch would merge two different games' moves.
drop index if exists public.game_moves_room_ply_idx;
create index if not exists game_moves_room_epoch_ply_idx on public.game_moves (room_id, epoch, ply);

create index if not exists game_rooms_status_idx on public.game_rooms (status);
create index if not exists game_rooms_kind_status_idx on public.game_rooms (game_kind, status);

comment on table public.game_moves is
  'Append-only move log. Rows are never deleted by a reset: submit_terminal_update advances game_rooms.reset_epoch instead, which starts a new log and leaves this one intact as the record of the game that preceded it. Rows still disappear when their room is deleted, via the on delete cascade above.';

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.game_rooms enable row level security;
alter table public.game_moves enable row level security;

-- Drop every previously created policy by name so this script is re-runnable.
drop policy if exists "Public anonymous access to insert/update game rooms" on public.game_rooms;
drop policy if exists "Public anonymous access to read game rooms" on public.game_rooms;
drop policy if exists "Public anonymous access to moves" on public.game_moves;
drop policy if exists "Allow seated players to update room turn and state" on public.game_rooms;
drop policy if exists "Allow reading game rooms" on public.game_rooms;
drop policy if exists "Allow inserting game rooms" on public.game_rooms;
drop policy if exists "Allow reading game moves" on public.game_moves;

-- Read access is public so observers can spectate without holding a seat.
create policy "Allow reading game rooms"
  on public.game_rooms for select
  using (true);

-- Creating a room is public: the caller mints and owns both seat tokens.
-- There is deliberately NO insert-into-moves and NO update policy on either
-- table, so every other mutation is forced through an RPC below.
create policy "Allow inserting game rooms"
  on public.game_rooms for insert
  with check (true);

create policy "Allow reading game moves"
  on public.game_moves for select
  using (true);

-- -----------------------------------------------------------------------------
-- RPC: submit_turn_move
-- -----------------------------------------------------------------------------
--
-- PAYLOAD BOUNDS
--
-- `p_board_snapshot` is the one argument a client can make arbitrarily large,
-- and it is stored verbatim in `game_rooms.board_snapshot` and served back to
-- every subscriber through Realtime. A board rule violation is a client-
-- authoritative concern (see the trust model above), but *size* and *shape*
-- are not: an 8 MB JSON blob would be replayed to both clients on every ply
-- and kept in WAL forever. So the RPC bounds two things it can check without
-- knowing the rules of any particular game:
--
--   * the serialized size, capped at 8192 bytes, which is roughly 4x the
--     largest legal board this app can produce (a 15x15 Gomoku position with
--     full history in the payload) and small enough that a Realtime frame
--     stays cheap;
--   * the `kind` discriminator, which must name the same game as the room. A
--     snapshot of the wrong game can never be replayed by the receiving
--     client, so accepting one would poison the room at exactly the moment the
--     integrity gate reads it.

create or replace function public.submit_turn_move(
  p_room_id uuid,
  p_player_token text,
  p_expected_version integer,
  p_move_id uuid,
  p_ply integer,
  p_player public.player_color,
  p_from_coord jsonb,
  p_to_coord jsonb,
  p_payload text,
  p_board_snapshot jsonb,
  p_winner public.player_color,
  p_status public.match_status,
  -- Reversi can leave a player with no legal move. That ply is still recorded,
  -- but the mover keeps the turn, so the hand-off has to be suppressible here
  -- rather than assumed from p_player.
  p_passes_turn boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.game_rooms%rowtype;
  v_next_turn public.player_color;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id
  for update;

  if not found then
    return 'room_not_found';
  end if;

  -- Reject moves on finished, waiting, or abandoned rooms.
  if v_room.status <> 'active' then
    return 'room_inactive';
  end if;

  -- Optimistic concurrency control: the caller's view must match the row.
  if v_room.version <> p_expected_version then
    return 'version_conflict';
  end if;

  -- Seat authorization + turn order, with a strict null check on the token.
  if p_player = 'black' then
    if v_room.player_black_token is null
       or v_room.player_black_token <> p_player_token
       or v_room.current_turn <> 'black' then
      return 'unauthorized';
    end if;
  else
    if v_room.player_white_token is null
       or v_room.player_white_token <> p_player_token
       or v_room.current_turn <> 'white' then
      return 'unauthorized';
    end if;
  end if;

  -- Payload bounds. Checked after authorization so an unauthenticated caller
  -- cannot use these two codes as an oracle for whether a room exists, and
  -- before the insert so nothing oversized ever reaches `game_moves` or the
  -- `game_rooms` row.
  if p_board_snapshot is null
     or octet_length(p_board_snapshot::text) > 8192 then
    return 'payload_too_large';
  end if;

  -- `is distinct from` rather than `<>`: a snapshot with no `kind` key, or one
  -- whose kind is JSON null, compares as NULL under `<>`, and a NULL condition
  -- is not TRUE — so the obvious spelling silently admits exactly the malformed
  -- payload this line exists to reject.
  if (p_board_snapshot ->> 'kind') is distinct from v_room.game_kind::text then
    return 'invalid_payload_kind';
  end if;

  -- Idempotent move insertion: a retried request must not duplicate a ply.
  -- Stamped with the room's current epoch so the move stays attributable to the
  -- game it was played in even after a later reset starts a new log on the same
  -- room. A move arriving after a reset is written by a client that has not yet
  -- seen the new epoch, so it lands in the old one; the version check above
  -- already makes that request a conflict, which is the correct outcome.
  insert into public.game_moves (id, room_id, epoch, ply, player, from_coord, to_coord, payload, created_at)
  values (p_move_id, p_room_id, v_room.reset_epoch, p_ply, p_player, p_from_coord, p_to_coord, p_payload, now())
  on conflict (id) do nothing;

  v_next_turn := case when p_player = 'black' then 'white' else 'black' end;

  update public.game_rooms
  set
    board_snapshot = p_board_snapshot,
    current_turn = case
      when p_status <> 'active' then v_room.current_turn
      when coalesce(p_passes_turn, false) then v_room.current_turn
      else v_next_turn
    end,
    turn_number = v_room.turn_number + 1,
    status = p_status,
    winner = p_winner,
    version = v_room.version + 1,
    updated_at = now()
  where id = p_room_id;

  return 'success';
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: join_room — atomic seat reservation for an incoming opponent
-- -----------------------------------------------------------------------------

create or replace function public.join_room(
  p_room_id uuid,
  p_player_token text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.game_rooms%rowtype;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id
  for update;

  if not found then
    return 'room_not_found';
  end if;

  -- Idempotent re-joins report the seat already held.
  if v_room.player_black_token = p_player_token then
    return 'seated_black';
  end if;

  if v_room.player_white_token = p_player_token then
    return 'seated_white';
  end if;

  if v_room.status <> 'waiting' then
    return 'room_closed';
  end if;

  if v_room.player_white_token is null then
    update public.game_rooms
    set
      player_white_token = p_player_token,
      status = 'active',
      version = v_room.version + 1,
      updated_at = now()
    where id = p_room_id;
    return 'seated_white';
  end if;

  return 'room_full';
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: submit_terminal_update — resign / reset without a client UPDATE policy
-- -----------------------------------------------------------------------------
-- Because public.game_rooms has no UPDATE policy, resign and reset must also
-- go through a SECURITY DEFINER RPC. A RESET starts a new epoch rather than
-- clearing game_moves, so that a client's later full-history replay re-derives
-- exactly the snapshot stored here instead of replaying the abandoned game's
-- log — while that log stays on the server as its record.

create or replace function public.submit_terminal_update(
  p_room_id uuid,
  p_player_token text,
  p_expected_version integer,
  p_board_snapshot jsonb,
  p_current_turn public.player_color,
  p_turn_number integer,
  p_winner public.player_color,
  p_status public.match_status,
  p_clear_history boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.game_rooms%rowtype;
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id
  for update;

  if not found then
    return 'room_not_found';
  end if;

  if v_room.version <> p_expected_version then
    return 'version_conflict';
  end if;

  -- Either seated player may resign or reset, but nobody else.
  if (v_room.player_black_token is null or v_room.player_black_token <> p_player_token)
     and (v_room.player_white_token is null or v_room.player_white_token <> p_player_token) then
    return 'unauthorized';
  end if;

  if p_turn_number is null or p_turn_number < 1 then
    return 'invalid_status';
  end if;

  if p_status is null then
    return 'invalid_status';
  end if;

  -- The same payload bounds as submit_turn_move, and for the same reason: this
  -- function writes `board_snapshot` on a room that already exists, so an
  -- unbounded blob here would be just as durable and just as widely broadcast.
  if p_board_snapshot is null
     or octet_length(p_board_snapshot::text) > 8192 then
    return 'payload_too_large';
  end if;

  if (p_board_snapshot ->> 'kind') is distinct from v_room.game_kind::text then
    return 'invalid_payload_kind';
  end if;

  -- A RESET used to delete this room's move log outright. That is the one
  -- thing an append-only ledger must never do: the moves being deleted are the
  -- only record of the game that was just abandoned or resigned, and the caller
  -- who resets is not necessarily the one who played them. Advancing
  -- reset_epoch starts a new log instead — ply numbering restarts at 1 within
  -- the new epoch, clients read only the current epoch, and every earlier move
  -- stays exactly where it was.
  --
  -- The update below and the epoch bump happen in the same statement, so the
  -- room never exists in a state where its epoch and its moves disagree.
  update public.game_rooms
  set
    board_snapshot = p_board_snapshot,
    current_turn = p_current_turn,
    turn_number = p_turn_number,
    status = p_status,
    winner = p_winner,
    version = v_room.version + 1,
    reset_epoch = case
      when p_clear_history then v_room.reset_epoch + 1
      else v_room.reset_epoch
    end,
    updated_at = now()
  where id = p_room_id;

  return 'success';
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
--
-- `SECURITY DEFINER` means the functions run as the migration role, so the
-- default `EXECUTE` granted to `PUBLIC` would let any authenticated *or*
-- anonymous caller run them as the owner. Each function is therefore revoked
-- from `PUBLIC` and re-granted to exactly the two roles the browser can hold.
-- Both statements are unconditional and repeatable: `revoke` and `grant` have
-- no "already done" state to guard against, so re-running this file changes
-- nothing and cannot leave a function executable by a role nobody audited.
--
-- The RLS policies above are idempotent by construction as well — PostgreSQL
-- has no `create policy if not exists`, so every policy is paired with a
-- `drop policy if exists` of the same name in the drop block above.

revoke execute on function public.submit_turn_move(uuid, text, integer, uuid, integer, public.player_color, jsonb, jsonb, text, jsonb, public.player_color, public.match_status, boolean) from public;
grant execute on function public.submit_turn_move(uuid, text, integer, uuid, integer, public.player_color, jsonb, jsonb, text, jsonb, public.player_color, public.match_status, boolean) to anon, authenticated;

revoke execute on function public.join_room(uuid, text) from public;
grant execute on function public.join_room(uuid, text) to anon, authenticated;

revoke execute on function public.submit_terminal_update(uuid, text, integer, jsonb, public.player_color, integer, public.player_color, public.match_status, boolean) from public;
grant execute on function public.submit_terminal_update(uuid, text, integer, jsonb, public.player_color, integer, public.player_color, public.match_status, boolean) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
--
-- `alter publication ... add table` has no `if not exists` form and raises
-- "table is already member of publication" on a second run, so the membership
-- check is made explicit here. Without it the file's promise of being
-- re-runnable stops at the last fifteen lines, which is the worst place for it
-- to stop: everything above has already been applied.

do $$ begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_rooms'
  ) then
    alter publication supabase_realtime add table public.game_rooms;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_moves'
  ) then
    alter publication supabase_realtime add table public.game_moves;
  end if;
end $$;
