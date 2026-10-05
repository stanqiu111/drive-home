// One shared Supabase client (null when the database isn't configured).
// The publishable/anon key is meant to be public; row-level security in
// supabase/schema.sql decides what each player can read and write.
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = URL && KEY ? createClient(URL, KEY) : null;
