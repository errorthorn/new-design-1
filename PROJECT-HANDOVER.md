# LingoCraft — Full Project Handover
_Written for whoever tests this next. Read this one file first — it links
out to the others (`README.md`, `STATUS.md`, `HANDOVER-25MIN-SESSIONS.md`)
only where more detail already exists, instead of repeating it._

This zip is the **entire working site** — not a diff, not a partial
update. Everything below is currently in the code.

---

## 1. What this site is

A Next.js app with three parts glued together:

| Part | Routes | Purpose |
|---|---|---|
| Marketing homepage | `/` | Landing page — hero, features, testimonials, a "join" CTA |
| Accounts | `/login`, `/signup`, `/forgot-password`, `/reset-password` | Email/password (+ optional Google) sign-in |
| Speaking Club mock test | `/mock-test`, `/mock-test/session` | The actual product: a live AI-voice English speaking test |

Plus three teacher-only admin pages: `/admin/questions`, `/admin/members`,
`/admin/scoring`.

---

## 2. Full feature list (what a tester should be able to do)

### Public / marketing
- Visit `/`, see the homepage, nav bar shows Login/Join when signed out.

### Accounts
- Sign up with email + password at `/signup`.
- Log in at `/login`. Nav bar switches to showing your name + Logout.
- Forgot password → `/forgot-password` → emailed a reset link (or, if
  `RESEND_API_KEY` isn't set, the link is printed to the server terminal
  instead — that's expected in local dev, not a bug).
- Optional Google sign-in, only if `GOOGLE_CLIENT_ID`/`SECRET` are set.

### Speaking Club subscription (manual, admin-granted)
- **There is no payment gateway.** A student's `subscription_active` flag
  lives on their account row (SQLite/Turso) and is turned on by hand.
- Teacher goes to `/admin/members`, enters `ADMIN_SECRET`, looks up a
  student by email, clicks **Grant** (defaults to 30 days) or **Revoke**.
- `/mock-test` and `/mock-test/session` both check
  `user.subscriptionActive` server-side before allowing anything — a
  student without an active subscription sees a "join Speaking Club"
  screen, not the test.

### Mock test — student side
1. Student logs in, goes to `/mock-test` (dashboard: past attempts,
   scores, feedback, streak) or directly to `/mock-test/session`.
2. **First time only**: a short name+phone form (auto-skipped on every
   later visit — the account's email is what's actually checked).
3. If they already tested this week, they see a "come back on \<date\>"
   screen instead of the test.
4. If eligible: **Test শুরু করো** → browser asks for mic permission →
   live voice conversation starts with an AI examiner that asks
   **exactly the questions the teacher configured**, one at a time, live
   captioned transcript on screen.
5. **Test শেষ করো** → transcript saved, the full audio recording (mic +
   AI examiner mixed together) uploaded, "done" screen.
6. Back on `/mock-test`, the completed attempt shows up, and once a
   teacher scores it, the student can also see their score/feedback and
   play back their own recording.

### Mock test — teacher side
- **`/admin/questions`** — add/remove/reorder the questions the AI
  examiner asks. This list is what actually controls the test content —
  the AI is instructed to ask *only* these, in this order.
- **`/admin/members`** — grant/revoke Speaking Club subscriptions by
  email (see above).
- **`/admin/scoring`** — list of completed attempts (Pending / Scored /
  All tabs), each showing the transcript, a play-recording button, a
  0–9 score field, and a feedback textarea. Saving writes back to the
  attempt row and the student sees it on their dashboard.
- All three share the same `ADMIN_SECRET` password (not a real user
  account — see security note below).

### Long-test support (25-minute sessions)
Just implemented this pass — see §5. Not yet verified with a real long
call.

---

## 3. How the pieces are wired together (architecture)

**Two separate databases, bridged by email:**

| System | Database | Why |
|---|---|---|
| Accounts (login, subscription flag) | SQLite via `@libsql/client`, or Turso in production | Already worked, simple, free |
| Mock test (students, attempts, questions) | Supabase (Postgres) | Already wired for Gemini Live |

When a signed-in user opens the mock test, their account email gets
written onto the Supabase `students.user_email` column. That's the only
link between the two databases — there's no foreign key, no merge, just
"same email = same person." Full reasoning in `README.md` → "Two
databases."

**The live voice conversation, at a glance:**
1. Browser calls `POST /api/mock-test/gemini-session` → server checks
   login+subscription+ownership, logs a new attempt row, mints a
   short-lived Gemini **ephemeral token** locked to your exact question
   list (your real `GOOGLE_API_KEY` never reaches the browser).
2. Browser opens a raw WebSocket directly to Google using that token,
   streams mic audio in, plays the examiner's voice back out, and
   receives live transcription for both sides.
3. On end: transcript → `/api/mock-test/complete`; recording → the new
   signed-upload-URL flow (§5) → Supabase Storage.

---

## 4. Environment variables — the complete list

```bash
# ---- Accounts ----
JWT_SECRET=                    # required — openssl rand -base64 48
GOOGLE_CLIENT_ID=               # optional — enables Google sign-in
GOOGLE_CLIENT_SECRET=           # optional
NEXTAUTH_SECRET=                # required IF using Google sign-in
NEXTAUTH_URL=http://localhost:3000
RESEND_API_KEY=                 # optional — real password-reset emails
EMAIL_FROM=LingoCraft <onboarding@resend.dev>
TURSO_DATABASE_URL=             # required only on read-only-filesystem hosts (Vercel)
TURSO_AUTH_TOKEN=               # same

# ---- Mock test (Supabase + Gemini) ----
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # NEW this pass — see §5 and the security note below
GOOGLE_API_KEY=

# ---- Admin pages ----
ADMIN_SECRET=                   # any password you choose; same one for all 3 admin pages
```

Full comments on where to get each one are in `.env.example`.

---

## 5. What changed in THIS pass — 25-minute session support

Implements `HANDOVER-25MIN-SESSIONS.md` point by point. Full detail
already in that file and in the zip's original `IMPLEMENTATION_NOTES.md`
— summary:

1. **`gemini-session/route.ts`** — added `contextWindowCompression`
   (removes the ~15-min content cap) and `sessionResumption` (lets the
   server hand back a reconnect handle), bumped ephemeral token
   `expireTime` 20→45 min. Also: a 429/quota error now returns a
   distinct, honest "busy, try again shortly" message instead of a
   generic 500.
2. **`gemini-live-client.ts`** (full rewrite) — listens for `goAway` and
   proactively reconnects using the saved `sessionResumptionUpdate`
   handle, **buffering mic audio during the ~1-2s swap** instead of
   dropping it (capped at ~30s so a real outage doesn't grow it
   forever). The recorder/AudioContext is untouched by a reconnect, so
   the saved recording has no gap even though the transcript/live-AI
   side does.
3. **Audio upload** — replaced the old server-proxy upload with
   Supabase's **signed-upload-URL** flow: server hands back a signed URL,
   browser `PUT`s the recording straight to Storage. This is what
   introduced `NEXT_PUBLIC_SUPABASE_ANON_KEY` — **see the security note
   right below, this is the one thing from this pass that needs a
   decision, not just testing.**

### ⚠️ Security note — read this before testing, not after
`sql/schema.sql` has a section (near the bottom) that enables permissive
RLS policies (`using (true)` — anyone can read/insert) on the
`students` and `mock_test_attempts` tables, originally added for a
legacy standalone-HTML version of this app that talked to Supabase
directly with the anon key.

Before this pass, the anon key was never actually shipped to the
browser in the Next.js app, so those permissive policies were dormant.
**This pass adds `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the browser bundle**
(needed for the signed-upload flow's `uploadToSignedUrl` call). That key
is now live in production, which means those old permissive RLS
policies are no longer dormant — anyone who opens devtools and finds
that key could read or insert rows in `students`/`mock_test_attempts`
directly, bypassing the app's own login/ownership checks entirely.

This wasn't part of the 25-minute-session task, so I didn't fix it
speculatively, but flagging it clearly since it's a real change in
exposure, not a hypothetical:
- **Option A (fast):** drop those two `create policy ...` blocks from
  `sql/schema.sql` (and run the `drop policy` equivalent on your live
  DB) — the app never needed them since it always goes through the
  server's service-role key anyway, except for this one new browser
  call.
- **Option B (correct):** replace them with real policies scoped to
  `auth.uid()` — bigger change, only worth it if you're also moving
  toward using Supabase Auth directly instead of the SQLite/JWT system.
- Either way, this needs a decision before this goes live for real
  students, not just a "run it and see."

### Still not done from the 25-min handover (unchanged from before)
- Concurrency action items #1/#3/#4 (check actual usage tier, consider
  staggered start times, talk to Google about tier limits) — these are
  account/product decisions, not code.
- **No real 15+ minute call has been run through any of this yet.**
  Both this pass and the original handover say the same thing: test a
  real long call before trusting it for actual students.

---

## 6. Known issues / not done — full list across the whole project

Pulled together from `STATUS.md` plus this pass, so it's all in one
place instead of scattered across files:

1. **`npm install && npm run build` has never been run in the sandbox
   that wrote this code** — no internet access there. Every pass has
   done careful manual review (brace/paren balance, type-shape checks
   against docs) instead of a real compile. **Run the real build before
   deploying** — if anything doesn't compile, the exact error is the
   fastest way to get it fixed.
2. **Two-database bridge is by email only**, no foreign key — if
   someone signs up with one email, then somehow checks in to the mock
   test with a different one, they'd get treated as two different
   people. Edge case, not currently guarded against.
3. **Recording upload failures are silent-non-fatal by design** — if it
   fails, the transcript/score flow still works, the teacher just won't
   have audio for that attempt. Nothing currently surfaces this to the
   teacher beyond server logs.
4. **"Practice Streak" on the student dashboard** is a simple heuristic
   (consecutive attempts within ~8 days), not anything more
   sophisticated — unchanged for several passes now.
5. **The RLS/anon-key exposure described in §5** — needs a decision,
   see above.
6. **The reconnect/25-min logic (§5) is unverified** — needs a real long
   call.
7. **`ADMIN_SECRET` is a single shared password, not real accounts** —
   fine for one teacher, would need real auth if more than one person
   needs different admin permissions.

---

## 7. Suggested test pass, in order

1. `npm install && npm run build` — confirms everything in §6.1.
2. Sign up, log in, log out, forgot-password flow.
3. Grant yourself a subscription via `/admin/members`.
4. Add 2-3 questions via `/admin/questions`.
5. Take a **short** (2-3 min) mock test first — confirms the basic voice
   loop, transcript, and recording upload all still work after this
   pass's changes, before testing the harder long-call path.
6. Check the recording plays back from `/admin/scoring` and the
   transcript looks right.
7. Take a **15+ minute** test — this is the one thing nothing in this
   project has verified yet. Watch for: does a `goAway` actually arrive
   around 10 min in, does the reconnect happen without the AI losing
   track of which question it's on, does the "সংযোগ নবায়ন করা হচ্ছে"
   indicator show up, does the final recording/transcript look
   continuous.
8. Try triggering the weekly block (test again immediately after) and
   the no-subscription screen (revoke via `/admin/members`, try again).

---

## 8. File map (for orientation, not exhaustive — see `README.md` for the full tree)

```
app/
  page.tsx                          marketing homepage
  login/ signup/ forgot-password/ reset-password/
  mock-test/page.tsx                student dashboard
  mock-test/session/page.tsx        the actual live test — CHANGED this pass
  admin/questions/ admin/members/ admin/scoring/
  api/auth/...                      account routes
  api/mock-test/gemini-session/     CHANGED this pass (compression, resumption, 429 handling)
  api/mock-test/upload-audio/       CHANGED this pass (signed-URL flow)
  api/mock-test/eligibility/ attempts/ complete/ questions/
  api/admin/members/ attempts/
lib/
  auth.js db.js mailer.js next-auth-options.js     accounts
  supabase.ts                        server-side Supabase client (service role)
  supabase-browser.ts                NEW this pass — anon-key client, upload-only
  gemini-live-client.ts              CHANGED this pass (reconnect/resumption, full rewrite)
sql/schema.sql                       run once in Supabase SQL editor — has the RLS note from §5
```
