-- Harden team membership checks and grant the authenticated role access to the Data API.
-- Membership helper lives outside the exposed public schema to avoid RLS recursion.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_team_member(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.team_members tm
    where tm.team_id = target_team and tm.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_team_member(uuid) from public;
grant execute on function private.is_team_member(uuid) to authenticated;

-- Replace policies that previously called an invoker helper and could recurse.
drop policy if exists "Profiles visible to teammates" on public.profiles;
create policy "Profiles visible to teammates" on public.profiles for select to authenticated
using (id = (select auth.uid()) or exists (
  select 1 from public.team_members mine
  join public.team_members theirs on theirs.team_id = mine.team_id
  where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
));

drop policy if exists "Teams visible to members" on public.teams;
create policy "Teams visible to members" on public.teams for select to authenticated
using (private.is_team_member(id));

drop policy if exists "Members see team membership" on public.team_members;
create policy "Members see team membership" on public.team_members for select to authenticated
using (private.is_team_member(team_id));

drop policy if exists "Members see team locations" on public.locations;
create policy "Members see team locations" on public.locations for select to authenticated
using (private.is_team_member(team_id));

drop policy if exists "Users write own location" on public.locations;
create policy "Users write own location" on public.locations for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_team_member(team_id));

drop policy if exists "Users update own location" on public.locations;
create policy "Users update own location" on public.locations for update to authenticated
using (user_id = (select auth.uid()) and private.is_team_member(team_id))
with check (user_id = (select auth.uid()) and private.is_team_member(team_id));

drop policy if exists "Members see relevant messages" on public.messages;
create policy "Members see relevant messages" on public.messages for select to authenticated
using (private.is_team_member(team_id) and (recipient_id is null or recipient_id = (select auth.uid()) or sender_id = (select auth.uid())));

drop policy if exists "Members send messages" on public.messages;
create policy "Members send messages" on public.messages for insert to authenticated
with check (sender_id = (select auth.uid()) and private.is_team_member(team_id)
  and (recipient_id is null or exists (
    select 1 from public.team_members target
    where target.team_id = messages.team_id and target.user_id = messages.recipient_id
  )));

drop policy if exists "Members see team pins" on public.map_pins;
create policy "Members see team pins" on public.map_pins for select to authenticated
using (private.is_team_member(team_id));

drop policy if exists "Members create pins" on public.map_pins;
create policy "Members create pins" on public.map_pins for insert to authenticated
with check (creator_id = (select auth.uid()) and private.is_team_member(team_id));

-- Invite-code lookup must not expose team invite codes to every authenticated user.
-- This narrowly scoped SECURITY DEFINER RPC checks auth.uid() and inserts only that user.
create or replace function public.join_team(code text)
returns public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare found_team public.teams;
begin
  if (select auth.uid()) is null then raise exception 'You must be signed in'; end if;
  select * into found_team from public.teams t where t.invite_code = upper(trim(code));
  if found_team.id is null then raise exception 'That invite code was not found'; end if;
  insert into public.team_members(team_id,user_id) values(found_team.id,(select auth.uid()))
  on conflict do nothing;
  return found_team;
end;
$$;

revoke all on function public.join_team(text) from public, anon;
grant execute on function public.join_team(text) to authenticated;
revoke all on function public.create_team(text) from public, anon;
grant execute on function public.create_team(text) to authenticated;

drop function if exists public.is_team_member(uuid);

-- Explicit table privileges are required in addition to RLS for Data API access.
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.map_pins to authenticated;
