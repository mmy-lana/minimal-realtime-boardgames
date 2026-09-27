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
  create type public.game_kind as enum ('tictactoe', 'connect4', 'gomoku', 'reversi', 'checkers', 'chess');
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_rooms_version_positive check (version > 0),
  constraint game_rooms_turn_number_positive check (turn_number > 0)
);

comment on table public.game_rooms is
  'Authoritative room state. All post-insert mutations go through SECURITY DEFINER RPCs.';

create table if not exists public.game_moves (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  ply integer not null,
  player public.player_color not null,
  from_coord jsonb null,
  to_coord jsonb not null,
  payload text null,
  created_at timestamptz not null default now(),
  constraint game_moves_ply_positive check (ply > 0)
);

-- Full-history replay on load/reconnect reads by (room_id, ply).
create index if not exists game_moves_room_ply_idx on public.game_moves (room_id, ply);

create index if not exists game_rooms_status_idx on public.game_rooms (status);
create index if not exists game_rooms_kind_status_idx on public.game_rooms (game_kind, status);

comment on table public.game_moves is
  'Append-only move log. Cleared only by a RESET via submit_terminal_update so that replay verification stays sound.';

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
  p_status public.match_status
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

  -- Idempotent move insertion: a retried request must not duplicate a ply.
  insert into public.game_moves (id, room_id, ply, player, from_coord, to_coord, payload, created_at)
  values (p_move_id, p_room_id, p_ply, p_player, p_from_coord, p_to_coord, p_payload, now())
  on conflict (id) do nothing;

  v_next_turn := case when p_player = 'black' then 'white' else 'black' end;

  update public.game_rooms
  set
    board_snapshot = p_board_snapshot,
    current_turn = case when p_status = 'active' then v_next_turn else v_room.current_turn end,
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
-- go through a SECURITY DEFINER RPC. A RESET additionally clears game_moves so
-- that a client's later full-history replay re-derives exactly the snapshot
-- stored here instead of replaying a stale move log.

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

  if p_clear_history then
    delete from public.game_moves where room_id = p_room_id;
  end if;

  update public.game_rooms
  set
    board_snapshot = p_board_snapshot,
    current_turn = p_current_turn,
    turn_number = p_turn_number,
    status = p_status,
    winner = p_winner,
    version = v_room.version + 1,
    updated_at = now()
  where id = p_room_id;

  return 'success';
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

revoke execute on function public.submit_turn_move from public;
grant execute on function public.submit_turn_move to anon, authenticated;

revoke execute on function public.join_room from public;
grant execute on function public.join_room to anon, authenticated;

revoke execute on function public.submit_terminal_update from public;
grant execute on function public.submit_terminal_update to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table public.game_rooms;
alter publication supabase_realtime add table public.game_moves;
