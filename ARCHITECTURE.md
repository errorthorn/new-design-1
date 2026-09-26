# Architecture notes

## Auth: two sign-in methods, one unified session check

This app supports two ways to sign in, on purpose:

1. **Email + password** — our own system. `lib/auth.ts` signs a JWT and
   stores it in an httpOnly cookie named `session`. Used directly by
   `/login`, `/signup`, `/forgot-password`, `/reset-password`.
2. **Google sign-in** — handled by NextAuth (`lib/next-auth-options.ts`),
   used *only* for the Google OAuth handshake. NextAuth keeps its own
   separate session cookie.

Both methods resolve to the same row in our own `users` table (see
`lib/db.ts`). On a successful Google sign-in, `next-auth-options.ts`
finds-or-creates that row and stores its id on the NextAuth token as
`dbId`.

**`getCurrentUser()`** in `lib/auth.ts` is the one place the rest of the
app should call to find out who's signed in. It checks our own `session`
cookie first, then falls back to a NextAuth session — so every page and
API route can stay agnostic about which method someone used.

Do not add a second way to check "is someone logged in" elsewhere in the
app — always go through `getCurrentUser()`.

## Dev-only login bypass

`lib/auth.ts` has a `BYPASS_LOGIN` flag, controlled by the `BYPASS_LOGIN`
env var (`BYPASS_LOGIN=true` in your local `.env` only). When on, every
request is treated as a standing "dev tester" account instead of
requiring a real sign-in — useful for quickly testing paywalled pages
locally. It must never be set in production; leaving it unset (the
default) behaves exactly like a normal app with no bypass.

## Database

`@libsql/client` — SQLite-compatible. Locally it writes to `data/app.db`
with no setup. On a host with a read-only filesystem (e.g. Vercel), set
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (from turso.tech) and the same
code talks to hosted SQLite instead — no query changes needed.

## Email

`lib/mailer.ts` sends via Resend. If `RESEND_API_KEY` isn't set, emails
are logged to the console instead of sent, so password reset / contact
form / payment notifications all still work locally without any email
provider configured.
