drop policy if exists "PTT participants can receive private broadcasts" on realtime.messages;
drop policy if exists "PTT participants can send private broadcasts" on realtime.messages;

create policy "PTT participants can receive private broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and (select realtime.topic()) ~* '^ptt:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$'
  and split_part((select realtime.topic()), ':', 3) < split_part((select realtime.topic()), ':', 4)
  and exists (
    select 1 from public.team_members mine
    where mine.team_id::text = split_part((select realtime.topic()), ':', 2)
      and mine.user_id = (select auth.uid())
      and mine.user_id::text in (split_part((select realtime.topic()), ':', 3), split_part((select realtime.topic()), ':', 4))
      and exists (
        select 1 from public.team_members peer
        where peer.team_id = mine.team_id
          and peer.user_id::text = case
            when mine.user_id::text = split_part((select realtime.topic()), ':', 3)
              then split_part((select realtime.topic()), ':', 4)
            else split_part((select realtime.topic()), ':', 3)
          end
      )
  )
);

create policy "PTT participants can send private broadcasts"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and (select realtime.topic()) ~* '^ptt:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$'
  and split_part((select realtime.topic()), ':', 3) < split_part((select realtime.topic()), ':', 4)
  and exists (
    select 1 from public.team_members mine
    where mine.team_id::text = split_part((select realtime.topic()), ':', 2)
      and mine.user_id = (select auth.uid())
      and mine.user_id::text in (split_part((select realtime.topic()), ':', 3), split_part((select realtime.topic()), ':', 4))
      and exists (
        select 1 from public.team_members peer
        where peer.team_id = mine.team_id
          and peer.user_id::text = case
            when mine.user_id::text = split_part((select realtime.topic()), ':', 3)
              then split_part((select realtime.topic()), ':', 4)
            else split_part((select realtime.topic()), ':', 3)
          end
      )
  )
);
