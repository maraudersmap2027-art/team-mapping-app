-- Server-side proximity check for claiming map pins (75 metre radius).
create or replace function private.claim_map_pin(target_pin uuid, claimant_lat double precision, claimant_lon double precision)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare pin_row public.map_pins;
declare distance_m double precision;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if claimant_lat is null or claimant_lon is null or claimant_lat not between -90 and 90 or claimant_lon not between -180 and 180 then raise exception 'A valid current location is required'; end if;
  select * into pin_row from public.map_pins where id = target_pin and claimed_at is null for update;
  if pin_row.id is null then return false; end if;
  if not private.is_team_member(pin_row.team_id) then raise exception 'You are not a member of this team'; end if;
  distance_m := 6371000 * 2 * asin(sqrt(
    power(sin(radians(claimant_lat - pin_row.latitude) / 2), 2) +
    cos(radians(pin_row.latitude)) * cos(radians(claimant_lat)) *
    power(sin(radians(claimant_lon - pin_row.longitude) / 2), 2)
  ));
  if distance_m > 75 then return false; end if;
  update public.map_pins set claimed_by = auth.uid(), claimed_at = now() where id = target_pin and claimed_at is null;
  return found;
end;
$$;
revoke all on function private.claim_map_pin(uuid,double precision,double precision) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.claim_map_pin(uuid,double precision,double precision) to authenticated;

create or replace function public.claim_map_pin(target_pin uuid, claimant_lat double precision, claimant_lon double precision)
returns boolean language sql security invoker set search_path = ''
as $$ select private.claim_map_pin(target_pin, claimant_lat, claimant_lon); $$;
revoke all on function public.claim_map_pin(uuid,double precision,double precision) from public, anon;
grant execute on function public.claim_map_pin(uuid,double precision,double precision) to authenticated;
