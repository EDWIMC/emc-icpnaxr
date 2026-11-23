-- FUTURE VISION XR collaborative classrooms
-- Run this migration in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.xr_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  title text not null default 'Future Vision XR classroom',
  host_id uuid not null references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours')
);

create table if not exists public.xr_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.xr_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Student',
  role text not null default 'student' check (role in ('host', 'student')),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create table if not exists public.xr_room_state (
  room_id uuid primary key references public.xr_rooms(id) on delete cascade,
  object_state jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists xr_rooms_code_active_idx on public.xr_rooms(code, is_active, expires_at);
create index if not exists xr_room_members_user_idx on public.xr_room_members(user_id, room_id);

create or replace function public.is_xr_room_member(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.xr_room_members m
    join public.xr_rooms r on r.id = m.room_id
    where m.room_id = target_room
      and m.user_id = auth.uid()
      and r.is_active = true
      and r.expires_at > now()
  );
$$;

revoke all on function public.is_xr_room_member(uuid) from public;
grant execute on function public.is_xr_room_member(uuid) to authenticated;

create or replace function public.create_xr_room(p_title text, p_display_name text)
returns table(room_id uuid, room_code text, room_title text, member_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.xr_rooms%rowtype;
  v_code text;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_name := left(coalesce(nullif(trim(p_display_name), ''), 'Teacher'), 32);
  loop
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from public.xr_rooms r where r.code = v_code);
  end loop;

  insert into public.xr_rooms(code, title, host_id)
  values (v_code, left(coalesce(nullif(trim(p_title), ''), 'Future Vision XR classroom'), 70), auth.uid())
  returning * into v_room;

  insert into public.xr_room_members(room_id, user_id, display_name, role)
  values (v_room.id, auth.uid(), v_name, 'host');

  insert into public.xr_room_state(room_id, object_state, updated_by)
  values (v_room.id, jsonb_build_object('objectType', 'robot', 'scale', 1, 'rotationY', 0), auth.uid());

  return query select v_room.id, v_room.code, v_room.title, 'host'::text;
end;
$$;

create or replace function public.join_xr_room(p_code text, p_display_name text)
returns table(room_id uuid, room_code text, room_title text, member_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.xr_rooms%rowtype;
  v_name text;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_room
  from public.xr_rooms r
  where r.code = upper(trim(p_code))
    and r.is_active = true
    and r.expires_at > now()
  limit 1;

  if v_room.id is null then
    raise exception 'Classroom not found or expired';
  end if;

  v_name := left(coalesce(nullif(trim(p_display_name), ''), 'Student'), 32);
  v_role := case when v_room.host_id = auth.uid() then 'host' else 'student' end;

  insert into public.xr_room_members(room_id, user_id, display_name, role)
  values (v_room.id, auth.uid(), v_name, v_role)
  on conflict (room_id, user_id) do update
    set display_name = excluded.display_name,
        role = case when public.xr_room_members.role = 'host' then 'host' else 'student' end,
        joined_at = now();

  return query select v_room.id, v_room.code, v_room.title, v_role;
end;
$$;

revoke all on function public.create_xr_room(text, text) from public;
revoke all on function public.join_xr_room(text, text) from public;
grant execute on function public.create_xr_room(text, text) to authenticated;
grant execute on function public.join_xr_room(text, text) to authenticated;

grant select on public.xr_rooms, public.xr_room_members, public.xr_room_state to authenticated;
grant insert, update on public.xr_room_state to authenticated;

alter table public.xr_rooms enable row level security;
alter table public.xr_room_members enable row level security;
alter table public.xr_room_state enable row level security;

drop policy if exists "Room members can read their room" on public.xr_rooms;
create policy "Room members can read their room"
on public.xr_rooms for select to authenticated
using (public.is_xr_room_member(id));

drop policy if exists "Room members can read membership" on public.xr_room_members;
create policy "Room members can read membership"
on public.xr_room_members for select to authenticated
using (public.is_xr_room_member(room_id));

drop policy if exists "Room members can read shared state" on public.xr_room_state;
create policy "Room members can read shared state"
on public.xr_room_state for select to authenticated
using (public.is_xr_room_member(room_id));

drop policy if exists "Room members can create shared state" on public.xr_room_state;
create policy "Room members can create shared state"
on public.xr_room_state for insert to authenticated
with check (public.is_xr_room_member(room_id) and updated_by = auth.uid());

drop policy if exists "Room members can update shared state" on public.xr_room_state;
create policy "Room members can update shared state"
on public.xr_room_state for update to authenticated
using (public.is_xr_room_member(room_id))
with check (public.is_xr_room_member(room_id) and updated_by = auth.uid());

-- Private Realtime channels: only members of the matching room code may read/write.
drop policy if exists "XR room members can receive private broadcasts" on realtime.messages;
create policy "XR room members can receive private broadcasts"
on realtime.messages for select to authenticated
using (
  exists (
    select 1 from public.xr_rooms r
    where r.code = split_part(realtime.topic(), ':', 2)
      and public.is_xr_room_member(r.id)
  )
);

drop policy if exists "XR room members can send private broadcasts" on realtime.messages;
create policy "XR room members can send private broadcasts"
on realtime.messages for insert to authenticated
with check (
  exists (
    select 1 from public.xr_rooms r
    where r.code = split_part(realtime.topic(), ':', 2)
      and public.is_xr_room_member(r.id)
  )
);
