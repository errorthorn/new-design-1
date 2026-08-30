import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side client only — never import this in a client component.
// SUPABASE_SERVICE_ROLE_KEY must stay in .env.local / Vercel env vars,
// never exposed with a NEXT_PUBLIC_ prefix.
//
// Built lazily: importing this file (e.g. from a page that only shows the
// "become a member" locked view) should never crash just because Supabase
// env vars aren't set yet. The client — and the env-var check — only run
// the first time something actually calls supabaseServer.from(...) etc.
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Supabase isn't configured yet — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
      );
    }
    _client = createClient(url, key);
  }
  return _client;
}

export const supabaseServer: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
