-- Replace join_team with the hardened function, while keeping team invite codes private.
-- This migration is intentionally separate so already-created projects can apply the fix.
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
  insert into public.team_members(team_id,user_id)
  values(found_team.id,(select auth.uid()))
  on conflict do nothing;
  return found_team;
end;
$$;
revoke all on function public.join_team(text) from public, anon;
grant execute on function public.join_team(text) to authenticated;
