-- Fix team creation under RLS.
-- INSERT ... RETURNING on public.teams requires a SELECT policy check.
-- A new team is not visible to its creator until their membership row exists.
-- Insert the team without RETURNING, add the creator as a member, then read it.

create or replace function public.create_team(team_name text)
returns public.teams
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_team public.teams;
  new_team_id uuid := gen_random_uuid();
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'You must be signed in';
  end if;

  insert into public.teams(id, name, owner_id)
  values (new_team_id, trim(team_name), current_user_id);

  insert into public.team_members(team_id, user_id)
  values (new_team_id, current_user_id);

  select * into new_team
  from public.teams
  where id = new_team_id;

  return new_team;
end;
$$;

revoke all on function public.create_team(text) from public, anon;
grant execute on function public.create_team(text) to authenticated;
