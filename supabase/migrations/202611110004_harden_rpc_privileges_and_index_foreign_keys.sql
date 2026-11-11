-- Move privileged invite-code lookup behind a private helper and narrow trigger execution.
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function private.join_team(code text)
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
revoke all on function private.join_team(text) from public, anon;
grant execute on function private.join_team(text) to authenticated;

create or replace function public.join_team(code text)
returns public.teams
language sql
security invoker
set search_path = ''
as $$
  select (private.join_team(code)).*;
$$;
revoke all on function public.join_team(text) from public, anon, authenticated;
grant execute on function public.join_team(text) to authenticated;

create index if not exists team_members_user_idx on public.team_members(user_id);
create index if not exists teams_owner_idx on public.teams(owner_id);
create index if not exists locations_user_idx on public.locations(user_id);
create index if not exists messages_sender_idx on public.messages(sender_id);
create index if not exists messages_recipient_idx on public.messages(recipient_id);
create index if not exists map_pins_creator_idx on public.map_pins(creator_id);
create index if not exists map_pins_claimed_by_idx on public.map_pins(claimed_by);
