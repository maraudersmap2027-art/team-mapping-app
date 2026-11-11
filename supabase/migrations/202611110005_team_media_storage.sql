-- Private team media storage for photo pins and push-to-talk audio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-media', 'team-media', false, 15728640, array['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/ogg','audio/wav'])
on conflict (id) do update set public = false, file_size_limit = 15728640,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Team members read team media" on storage.objects;
create policy "Team members read team media" on storage.objects
for select to authenticated
using (bucket_id = 'team-media' and private.is_team_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "Team members upload team media" on storage.objects;
create policy "Team members upload team media" on storage.objects
for insert to authenticated
with check (bucket_id = 'team-media'
  and (storage.foldername(name))[1] is not null
  and private.is_team_member(((storage.foldername(name))[1])::uuid)
  and (storage.foldername(name))[2] = (select auth.uid())::text);

drop policy if exists "Owners delete own team media" on storage.objects;
create policy "Owners delete own team media" on storage.objects
for delete to authenticated
using (bucket_id = 'team-media'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and private.is_team_member(((storage.foldername(name))[1])::uuid));
