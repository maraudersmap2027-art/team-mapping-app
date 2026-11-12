-- Owner-only team management actions. All privileged RPCs validate auth.uid() internally.
create or replace function public.remove_team_member(target_team uuid, target_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare acting_owner uuid; removed_count integer;
begin
  if (select auth.uid()) is null then raise exception 'You must be signed in'; end if;
  select owner_id into acting_owner from public.teams where id = target_team;
  if acting_owner is null or acting_owner <> (select auth.uid()) then raise exception 'Only the team owner can remove members'; end if;
  if target_user = acting_owner then raise exception 'The team owner cannot remove themselves'; end if;
  delete from public.locations where team_id = target_team and user_id = target_user;
  delete from public.team_members where team_id = target_team and user_id = target_user;
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end; $$;
revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;

create or replace function public.leave_team(target_team uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare acting_user uuid := (select auth.uid()); acting_owner uuid; removed_count integer;
begin
  if acting_user is null then raise exception 'You must be signed in'; end if;
  select owner_id into acting_owner from public.teams where id = target_team;
  if acting_owner is null then raise exception 'Team not found'; end if;
  if acting_owner = acting_user then raise exception 'The team owner must transfer ownership before leaving'; end if;
  delete from public.locations where team_id = target_team and user_id = acting_user;
  delete from public.team_members where team_id = target_team and user_id = acting_user;
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end; $$;
revoke all on function public.leave_team(uuid) from public, anon;
grant execute on function public.leave_team(uuid) to authenticated;

create or replace function public.rotate_team_invite_code(target_team uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare new_code text;
begin
  if (select auth.uid()) is null then raise exception 'You must be signed in'; end if;
  update public.teams set invite_code = upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10))
  where id = target_team and owner_id = (select auth.uid()) returning invite_code into new_code;
  if new_code is null then raise exception 'Only the team owner can reset the invite code'; end if;
  return new_code;
end; $$;
revoke all on function public.rotate_team_invite_code(uuid) from public, anon;
grant execute on function public.rotate_team_invite_code(uuid) to authenticated;
