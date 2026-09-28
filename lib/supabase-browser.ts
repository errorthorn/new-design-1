"use client";

import { createClient } from "@supabase/supabase-js";

// Anon-key client for the browser. Unlike lib/supabase.ts (service role,
// server-only), this key is safe to expose — it can only do what the
// signed URL/token it's given explicitly authorizes, in this app that's
// just "upload to this exact path", nothing else.
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
