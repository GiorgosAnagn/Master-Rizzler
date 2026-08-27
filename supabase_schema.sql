create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.players') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'players' and column_name = 'id' and data_type = 'uuid') then
    alter table public.players rename to legacy_players;
  end if;
  if to_regclass('public.point_events') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'point_events' and column_name = 'group_id') then
    alter table public.point_events rename to legacy_point_events;
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Rizzler Group' check (length(trim(name)) between 1 and 60),
  code text not null unique check (code ~ '^[0-9]{6}$'),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'active')),
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  description text not null check (length(trim(description)) between 1 and 200),
  points integer not null check (points <> 0 and points between -1000 and 1000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.point_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  task_id uuid not null references public.group_tasks(id),
  action text not null,
  points integer not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.new_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(split_part(new.email, '@', 1), ''), 'Player'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_rizzler on auth.users;
create trigger on_auth_user_created_rizzler after insert on auth.users
for each row execute procedure public.new_user_profile();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_tasks enable row level security;
alter table public.point_events enable row level security;

drop policy if exists "profiles own data" on public.profiles;
create policy "profiles own data" on public.profiles for all to authenticated
using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "members read groups" on public.groups;
create policy "members read groups" on public.groups for select to authenticated
using (exists (select 1 from public.group_members m where m.group_id = id and m.user_id = auth.uid() and m.status = 'active'));

drop policy if exists "members read memberships" on public.group_members;
create policy "members read memberships" on public.group_members for select to authenticated
using (user_id = auth.uid());

drop policy if exists "members read tasks" on public.group_tasks;
create policy "members read tasks" on public.group_tasks for select to authenticated
using (exists (select 1 from public.group_members m where m.group_id = public.group_tasks.group_id and m.user_id = auth.uid() and m.status = 'active'));

drop policy if exists "members read events" on public.point_events;
create policy "members read events" on public.point_events for select to authenticated
using (exists (select 1 from public.group_members m where m.group_id = public.point_events.group_id and m.user_id = auth.uid() and m.status = 'active'));
