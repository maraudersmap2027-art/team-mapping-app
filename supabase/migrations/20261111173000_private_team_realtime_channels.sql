drop policy if exists "Team members can receive private app channels" on realtime.messages;
create policy "Team members can receive private app channels"
on realtime.messages
for select
to authenticated
using (
  extension in ('broadcast', 'presence')
  and (select realtime.topic()) ~ '^team-(chat|map)-[0-9a-f-]{36}$'
  and exists (
    select 1 from public.team_members tm
    where tm.team_id::text = right((select realtime.topic()), 36)
      and tm.user_id = (select auth.uid())
  )
);