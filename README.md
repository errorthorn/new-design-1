# LingoCraft — Full-stack site

This project merges three previously separate pieces into one Next.js app:

1. **Marketing homepage** (`/`) — hero, features, how it works, etc.
2. **Accounts** (`/login`, `/signup`, `/forgot-password`, `/reset-password`) — email/password + optional Google sign-in.
3. **Mock Test** (`/mock-test`) — a live, AI-voice IELTS speaking mock test, plus a teacher admin page at `/admin/questions`.

## How they're connected

- The homepage's nav bar checks `/api/auth/me` and shows **Login / Join** or
  **your name + Logout** depending on whether you're signed in.
- **`/mock-test` now requires an account.** If you open it while signed out,
  it redirects you to `/login?next=/mock-test` and brings you back after you
  sign in.
- Your mock test attempts are linked to your account's email, not just a
  phone number typed into a form — so "have you already tested this week"
  is checked against *your account*, not an anonymous entry.

### Two databases — an important design decision

This project intentionally uses **two separate databases**, because the two
systems were built independently and each already works well on its own:

| System | Database | Why |
|---|---|---|
| Accounts (login/signup) | SQLite via `@libsql/client` (works locally with zero setup; point it at [Turso](https://turso.tech) for production) | Simple, free, nothing to configure for local dev |
| Mock Test (students, attempts, questions) | [Supabase](https://supabase.com) (Postgres) | Already wired up for the Gemini Live integration |

They're bridged by one thing: **email**. When a signed-in user opens the
mock test, their account email is sent to the mock-test API and stored on
the Supabase `students` row (`user_email` column). That's enough to
recognize the same person consistently, without merging the two databases.

**If you'd rather have one database for everything** (e.g. move accounts
into Supabase too, or move the mock test into the SQLite/Turso database),
that's a bigger, separate migration — happy to help with that next, just
say the word. For now, this bridge is the least risky way to connect what
you already had working.

## Setup

```bash
npm install
cp .env.example .env.local
# fill in .env.local — see comments in that file for where to get each key
npm run dev
```

Minimum to get each piece running locally:

- **Homepage** — works with no env vars at all.
- **Login/Signup (email + password)** — works with no env vars at all
  (writes to a local `data/app.db` SQLite file). Set `JWT_SECRET` before
  deploying anywhere real.
- **Google sign-in** — needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. Leave blank to just hide/disable it.
- **Password-reset emails** — needs `RESEND_API_KEY`. Leave blank and the
  reset link is printed to your terminal instead (fine for local dev).
- **Mock Test** — needs `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` (after running `sql/schema.sql` once in your
  Supabase project's SQL editor) and `GOOGLE_API_KEY` (for Gemini Live).
  Re-running `sql/schema.sql` also creates the private `mock-test-audio`
  and `study-materials` Storage buckets — nothing extra to click in the
  Supabase dashboard.
- **Study Materials** (`/study-materials`, members-only) — uses the same
  Supabase project as Mock Test, so no extra env vars once that's set up.
  Admin manages content from `/admin/study-materials`.
- **`/admin/questions`, `/admin/members`, `/admin/scoring`,
  `/admin/study-materials`, `/admin/testimonials`** — all need
  `ADMIN_SECRET` (any password you choose; same one for all five).
- **Testimonials marquee** (homepage "Members say" section) — the member
  side (photos + quotes you add at `/admin/testimonials`) uses the same
  Supabase project as Mock Test, so no extra env vars once that's set up.
  Re-running `sql/schema.sql` also creates the public `testimonial-avatars`
  Storage bucket. The real-Google-reviews half is optional and needs
  `GOOGLE_PLACES_API_KEY` (Google Cloud Console → enable "Places API",
  billing required though usage stays well within Google's free monthly
  credit at normal traffic) and `GOOGLE_PLACE_ID` (your business's Place
  ID — look it up at
  https://developers.google.com/maps/documentation/places/web-service/place-id).
  Leave both blank and the marquee just shows member testimonials, no
  Google badge. Note Google's API caps this at 5 reviews, chosen by Google
  as "most relevant" — there's no official way to request more or pick
  which 5.

## Project structure

```
app/
  page.tsx                  marketing homepage
  login/, signup/,
  forgot-password/,
  reset-password/           account pages
  mock-test/                weekly dashboard (real attempt history, subscription-gated)
  mock-test/session/        the check-in (once) + live AI speaking test + recording upload
  admin/questions/          teacher tool to manage test questions
  admin/members/            teacher/admin tool to grant Speaking Club subscriptions
  admin/scoring/            teacher tool to score completed tests + write feedback + play recordings
  api/auth/...              account API routes
  api/mock-test/...         eligibility (GET=lookup/POST=check-in), attempts, gemini-session,
                             complete, questions, upload-audio, attempts/audio (student's own signed URL)
  api/admin/members/        grant/revoke subscription API, protected by ADMIN_SECRET
  api/admin/attempts/       list + score/feedback API for the scoring panel, protected by ADMIN_SECRET
  api/admin/attempts/audio/ signed URL for a teacher to play one attempt's recording
  api/admin/testimonials/   CRUD + photo upload for testimonials, protected by ADMIN_SECRET
  api/testimonials/         public GET — merges real Google reviews + published member testimonials
  api/google-reviews/       public GET — fetches your Google Business Profile reviews (Places API)
lib/
  auth.js, db.js,
  mailer.js,
  next-auth-options.js      accounts (SQLite/Turso + NextAuth)
  supabase.ts,
  gemini-live-client.ts     mock test (Supabase + Gemini Live)
sql/schema.sql              run once in Supabase's SQL editor
```

## Deploying

Any Next.js host works (Vercel, Railway, etc.). Set the environment
variables above in your host's dashboard. If you deploy to a host with a
read-only filesystem (Vercel), you must set `TURSO_DATABASE_URL` /
`TURSO_AUTH_TOKEN` — the local SQLite file won't persist otherwise.
