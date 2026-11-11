-- Publish profile changes so teammates see handle and status updates live.
alter publication supabase_realtime add table public.profiles;
