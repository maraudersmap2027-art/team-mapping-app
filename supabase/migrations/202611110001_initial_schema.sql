-- Team Mapping Platform: initial schema
-- All exposed application tables use RLS. Never place a service-role key in the client.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (char_length(handle) between 2 and 32),
  status text not null default 'active' check (status in ('active','idle','away')),
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(8),'hex'),1,10)),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id,user_id)
);

create table if not exists public.locations (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  updated_at timestamptz not null default now(),
  primary key (team_id,user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete cascade,
  body text,
  audio_path text,
  created_at timestamptz not null default now(),
  constraint message_has_content check (
    (body is not null and char_length(body) > 0) or audio_path is not null
  )
);

create table if not exists public.map_pins (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text,
  image_path text,
  image_url text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz
);

create index if not exists locations_team_idx on public.locations(team_id);
create index if not exists messages_team_created_idx on public.messages(team_id,created_at desc);
create index if not exists pins_team_created_idx on public.map_pins(team_id,created_at desc);

create or replace function public.is_team_member(target_team uuid)
returns boolean language sql stable security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = target_team and tm.user_id = (select auth.uid())
  );
$$;

create or replace function public.create_team(team_name text)
returns public.teams language plpgsql security invoker
set search_path = ''
as $$
declare new_team public.teams;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  insert into public.teams(name,owner_id) values (team_name,auth.uid()) returning * into new_team;
  insert into public.team_members(team_id,user_id) values (new_team.id,auth.uid());
  return new_team;
end;
$$;

create or replace function public.join_team(code text)
returns public.teams language plpgsql security invoker
set search_path = ''
as $$
declare found_team public.teams;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into found_team from public.teams t where t.invite_code = upper(trim(code));
  if found_team.id is null then raise exception 'That invite code was not found'; end if;
  insert into public.team_members(team_id,user_id) values(found_team.id,auth.uid())
  on conflict do nothing;
  return found_team;
end;
$$;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.locations enable row level security;
alter table public.messages enable row level security;
alter table public.map_pins enable row level security;

create policy "Profiles visible to teammates" on public.profiles for select to authenticated
using (id = (select auth.uid()) or exists (
  select 1 from public.team_members mine
  join public.team_members theirs on theirs.team_id = mine.team_id
  where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
));
create policy "Users update own profile" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Users insert own profile" on public.profiles for insert to authenticated
with check (id = (select auth.uid()));

create policy "Teams visible to members" on public.teams for select to authenticated
using (public.is_team_member(id));
create policy "Signed-in users create teams" on public.teams for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy "Members see team membership" on public.team_members for select to authenticated
using (public.is_team_member(team_id));
create policy "Users join themselves" on public.team_members for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Members see team locations" on public.locations for select to authenticated
using (public.is_team_member(team_id));
create policy "Users write own location" on public.locations for insert to authenticated
with check (user_id = (select auth.uid()) and public.is_team_member(team_id));
create policy "Users update own location" on public.locations for update to authenticated
using (user_id = (select auth.uid()) and public.is_team_member(team_id))
with check (user_id = (select auth.uid()) and public.is_team_member(team_id));

create policy "Members see relevant messages" on public.messages for select to authenticated
using (public.is_team_member(team_id) and (recipient_id is null or recipient_id = (select auth.uid()) or sender_id = (select auth.uid())));
create policy "Members send messages" on public.messages for insert to authenticated
with check (sender_id = (select auth.uid()) and public.is_team_member(team_id)
  and (recipient_id is null or exists (
    select 1 from public.team_members target
    where target.team_id = messages.team_id and target.user_id = messages.recipient_id
  )));

create policy "Members see team pins" on public.map_pins for select to authenticated
using (public.is_team_member(team_id));
create policy "Members create pins" on public.map_pins for insert to authenticated
with check (creator_id = (select auth.uid()) and public.is_team_member(team_id));
create policy "Creators update own unclaimed pins" on public.map_pins for update to authenticated
using (creator_id = (select auth.uid()) and claimed_at is null)
with check (creator_id = (select auth.uid()) or claimed_by = (select auth.uid()));
create policy "Creators delete own unclaimed pins" on public.map_pins for delete to authenticated
using (creator_id = (select auth.uid()) and claimed_at is null);

-- Profile rows are created from trusted auth identity data; handle uniqueness is enforced.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare safe_handle text;
begin
  safe_handle := coalesce(nullif(trim(new.raw_user_meta_data->>'handle'),''), 'member-' || substr(new.id::text,1,8));
  insert into public.profiles(id,handle) values(new.id,safe_handle)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute procedure public.handle_new_user();

grant execute on function public.create_team(text) to authenticated;
grant execute on function public.join_team(text) to authenticated;
grant execute on function public.is_team_member(uuid) to authenticated;

-- Realtime subscriptions used by the client.
do $$
begin
  alter publication supabase_realtime add table public.locations;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.map_pins;
exception when duplicate_object then null;
end $$;

-- Photo/audio objects should be stored in private buckets with team-aware policies
-- before enabling uploads. Bucket policies are added in a later migration.
