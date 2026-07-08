import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

// Questo e' il "telefono" con cui il worker parla col database Supabase.
// Usa la service role key: significa che salta le regole RLS e vede
// TUTTE le agenzie. Va bene perche' il worker e' codice fidato lato server,
// ma proprio per questo la chiave non deve MAI finire nel frontend.
export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false, // il worker non e' un utente loggato, non serve
      autoRefreshToken: false,
    },
  }
);
