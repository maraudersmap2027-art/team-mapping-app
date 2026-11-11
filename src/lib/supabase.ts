import { createClient } from '@supabase/supabase-js';

// Supabase publishable keys are designed for browser use. Row-level security
// remains the authorization boundary; never place a service-role key here.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://vuwnnawonszpsxgipkcg.supabase.co';
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || 'sb_publishable_wDBdprZOX0ziyDg5lvwLaw_klgavAEg';

export const isSupabaseConfigured = Boolean(url && key);
export const supabase = isSupabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
