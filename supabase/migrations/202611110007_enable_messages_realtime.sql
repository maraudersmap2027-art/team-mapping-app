-- Enable realtime inserts/updates for the team communications feed.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
