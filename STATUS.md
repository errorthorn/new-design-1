# STATUS — handover notes (updated)

## 🆕 Latest pass — Speaking Club Phase 7 (Monitoring & Hardening)

Implements plan §9 Phase 7 — **as far as it can be implemented from this
sandbox.** The plan itself scopes Phase 7 as "post-launch, ongoing" and
dependent on "everything above being live," so its real deliverables
(watch real TURN usage for 1-2 weeks, watch real partner-absent
frequency, bug-fix based on real usage) need actual students and actual
time passing — no code substitutes for that. **Read `PHASE7-TESTING.md`
first** — it explains this in more detail and has the full test
checklist. What this pass built is the infrastructure those decisions
need, so nothing about the monitoring window is blocked on more
engineering work once the feature goes live:

- **TURN usage logging (§7):** `hooks/use-speaking-room-call.ts` now reads
  each `RTCPeerConnection`'s `getStats()` when a call ends, detects
  whether that peer connection actually needed TURN relay (vs direct
  P2P) and how many bytes it relayed, and reports it via
  `navigator.sendBeacon` (survives the tab just closing, the most common
  way a call ends) to the new `POST /api/speaking-club/turn-stats` route.
  New `speaking_turn_usage` table (`sql/schema.sql`) + `recordTurnUsage()`/
  `getTurnUsageSummary()` (`lib/speaking-club-db.ts`) store and aggregate
  it — daily totals, relay-rate %, and a rolling current-month GB figure
  to compare against Cloudflare's 1000 GB free quota.
- **Reassignment frequency (§9 Phase 7's other ask):** no new table
  needed — Phase 5's `speaking_reassignments` audit log was written with
  this in mind. New `getReassignmentFrequencySummary()` reads it: 30-day
  counts by reason, plus currently-open alerts.
- **Admin panel:** new "Monitoring" tab (`app/admin/speaking-club/page.tsx`)
  backed by new `GET /api/admin/speaking-club/monitoring` — summary cards,
  a quota progress bar, and a per-day usage table. Loads lazily on first
  open, no polling (this data moves over hours/days, not minutes).

**⚠️ Not tested — worse than usual this pass.** Confirmed this time (not
just assumed): a plain `npm install` in this sandbox fails with `403
Forbidden` against the npm registry, so there's no `node_modules` and not
even `npx tsc --noEmit` could run. Everything above was hand-matched
against the existing codebase's exact patterns and manually reviewed for
brace/type consistency — **run `npx tsc --noEmit` and `next lint` for
real**, then work through `PHASE7-TESTING.md`'s 9-item checklist
(including the tab-close/`sendBeacon` case and the forced-TURN case)
before trusting the Monitoring tab's numbers.

**Known gaps, deliberately left as-is — see `PHASE7-TESTING.md`'s "Known
gaps" section:** no retention/cleanup policy on the new usage-log table
(fine at this scale for a long time), fixed 14-day lookback window (not
configurable yet), no per-student/per-room usage breakdown (only daily
totals, matching what the plan actually asks Phase 7 to watch), and the
"general bug-fixing" part of Phase 7 genuinely deferred until there's real
usage data to fix against instead of guesses.

## Previous pass — Speaking Club Phase 6 (Notification Automation — app side)

Implements plan §9 Phase 6's app-side contract — the two things n8n needs
to actually integrate against. **The n8n workflows themselves are not
built** (no access to an n8n instance from here) — see
`PHASE6-N8N-SETUP.md` for the step-by-step to build them, written against
what's below.

- `app/api/cron/speaking-club-roster/route.ts` — new. `GET
  ?shiftNumber=1|2|3`, `requireCron()`-protected (same secret as the Phase
  5 alert-detection cron route). Returns every filled seat's email, name,
  room, passkey, and shift window for that shift — the exact data an n8n
  schedule-triggered workflow needs to email routine passkeys before each
  shift (plan §6).
- `lib/mailer.ts` — new `notifyReassignmentViaN8n()`. When
  `N8N_REASSIGNMENT_WEBHOOK_URL` is set, POSTs the reassignment notice
  there (n8n's own Email node sends it — the notification's actual
  long-term home per plan §4.4) instead of this app sending it via Resend.
  Returns `false` (webhook not configured, or the call failed) so the
  caller falls back to the existing direct-send — same graceful-degrade
  pattern as every other function in this file.
- `app/api/admin/speaking-club/alerts/resolve/route.ts` and
  `.../reassign-proactive/route.ts` — both now try
  `notifyReassignmentViaN8n()` first, fall back to
  `sendSpeakingClubReassignmentEmail()` only if that returns `false`. This
  is purely additive: with `N8N_REASSIGNMENT_WEBHOOK_URL` unset (the
  default), behavior is identical to Phase 5.
- `.env.example` — documented `N8N_REASSIGNMENT_WEBHOOK_URL` and the
  optional `N8N_REASSIGNMENT_WEBHOOK_SECRET` (sent as `x-webhook-secret`,
  pairs with n8n's Webhook node → Header Auth).
- `PHASE6-N8N-SETUP.md` — new. The actual n8n workflow build (Schedule
  Trigger → HTTP Request → Loop → Email for routine notification; Webhook
  → Email → Respond for reassignment), written for whoever has n8n access
  to follow.

**⚠️ Not tested — same caveat as Phase 5's latest pass**, plus this time
there's a whole extra untested surface (n8n itself) that literally cannot
be tested from this sandbox at all, only documented. Before relying on
this: run `npx tsc --noEmit` / `next lint` for real, then work through
`PHASE6-N8N-SETUP.md`'s two workflows end-to-end, including its "test
before relying on it" checklist for confirming the fallback path still
works if n8n is ever down.

## Previous pass — Speaking Club Phase 5 (Partner-Absent Handling) — completed

Finishes the 🔲 list from `PHASE5-HANDOFF.md` (schema, detection logic,
presence heartbeat, alerts GET route, and the room/dashboard wiring were
already done in the prior pass). New/changed this pass:

- `app/api/admin/speaking-club/alerts/resolve/route.ts` — new. Resolves one
  open alert: `move_empty` / `add_third` (calls `reassignStudent()` on the
  alert's `present_username`, `resolveAlert()`, then emails + marks
  notified) or `dismiss` (just `resolveAlert(id, "dismissed")`). Guards
  against a target seat filling up between the alert list being fetched and
  the admin clicking confirm (409, not a silent overwrite).
- `app/api/admin/speaking-club/reassign-proactive/route.ts` — new. Plan
  §4.5's planned-conflict flow: picks a student + target room+shift; if
  they're already on another shift with the same `shift_number`, clears
  that old seat first (`clearSeatForUsername()`), then `reassignStudent()`
  with `reason: "proactive_conflict"`.
- `app/api/cron/speaking-club-alerts/route.ts` — new. `requireCron()` +
  `detectAndFlagPartnerAbsences()`, GET and POST, for a scheduler (Vercel
  Cron / n8n) to hit every 1-2 min per plan §4.1/§4.4.
- `app/admin/speaking-club/page.tsx` — Alerts tab is now real, not Phase
  0's mock array: `AlertRow` type matching the `/alerts` GET response,
  `loadAlerts()`, a 60s poll while the tab is open, a rewritten
  `ReassignModal` (real empty-room/3rd-person target lists from the alert,
  a Dismiss button, posts to `alerts/resolve`), and a new
  `ProactiveReassignForm` card (student search + target picker, posts to
  `reassign-proactive`). Header copy and the tab badge no longer reference
  mock data.
- `.env.example` — documented `CRON_SECRET` (optional, falls back to
  `ADMIN_SECRET`, see `requireCron()`'s comment in `lib/admin-auth.ts`).
- `PHASE5-TESTING.md` — new, 9 test cases covering detection, both
  reassignment paths, dismiss, the no-targets-available state, the
  stale-target race guard, proactive reassignment, and cron auth.

**⚠️ Not type-checked or run this pass** — worse than the sandbox-network
caveat every previous phase's docs mention: this pass additionally had **no
`node_modules` and no network to install one**, so not even `npx tsc` could
run. Everything was hand-matched against the existing codebase's exact
patterns and types (`lib/speaking-club-db.ts`'s already-written Phase 5
helpers, `lib/admin-auth.ts`, `lib/mailer.ts`, the Phase 4 routes) and
manually reviewed for brace/type consistency, but **please run
`npx tsc --noEmit` and `next lint` for real, then work through
`PHASE5-TESTING.md`'s 9 cases against real Supabase/Turso data**, before
considering Speaking Club feature-complete.

**Known gaps, deliberately left as-is — see `PHASE5-TESTING.md`'s "Known
gaps" section:** `alerts/resolve` doesn't clear the lonely student's old
seat (only `reassign-proactive` does); the Alerts tab's 60s poll is a
nice-to-have addition beyond what the handoff doc asked for; proactive
reassignment only clears the *same-shift_number* old seat, not every
assignment a student might hold.

## Previous pass — Speaking Club Phase 4 (Admin Panel: Assignment)

Implements plan §9 Phase 4, on top of the already-locked Phase 1 schema and
Phase 0's admin panel design (`app/admin/speaking-club/page.tsx`'s Rooms/
Assign tab layout, previously mock data only). New/changed:

- `lib/speaking-club-db.ts` — added `assignSeat()` (set one seat without
  touching the other), `getAssignedUsernames()` / `findOpenSeats()` (pure
  helpers over a shift list, used by auto-pair). `listAllShifts()` and
  `assignStudents()` already existed from Phase 1/3 and are reused as-is.
- `lib/speaking-club-users.ts` — added `searchSpeakingClubUsers()` (email/
  name search over Turso `users`) and `listSubscribedUsers()` (every
  `subscription_active = 1` account — the pool auto-pair draws from).
- `app/api/admin/speaking-club/{shifts,users,assign,bulk-assign,auto-pair}/route.ts`
  — five new admin-only routes (same `requireAdmin()` shared-secret pattern
  as every other `/api/admin/*` route), covering §5.1-§5.3: the room/shift
  table view, user search, single assignment, CSV bulk assignment, and a
  two-step (preview → confirm) auto-pair.
- `app/admin/speaking-club/page.tsx` — "Rooms & Shifts" and "Assign
  Students" tabs are now wired to the routes above instead of Phase 0's
  mock arrays; clicking any shift cell opens an assign modal with live
  user search. **"Alerts" is deliberately left as Phase 0's mock data**
  (now labeled "Alerts (Phase 5)") — partner-absent detection/reassignment
  is Phase 5's job per the plan, not Phase 4's, and needs live Phase 2
  presence data this pass has no way to exercise.

**`npx tsc --noEmit`, `npx eslint`, and `next lint` — zero errors/warnings**
on every new/changed file, and the whole project still type-checks clean.
**Not tested against real Supabase/Turso data** (same sandbox network
limitation as Phase 2/3) — **read `PHASE4-TESTING.md` and run through all
5 test cases** (table load, single assign from table, single assign from
tab, bulk CSV, auto-pair preview+confirm) before marking this phase done.

**Known gaps, deliberately out of Phase 4's scope** — see
PHASE4-TESTING.md's "Known gaps" section: no dedicated un-assign button
(clear via the picker's × then save works), no room-inactive toggle in the
UI, no pagination (fine at 50 rooms). Assigning a student through any of
these three flows does **not** email them their passkey — that's Phase 6.

## Speaking Club Phase 3 (Student-Facing Access)

Implements plan §9 Phase 3, on top of Phase 2's real call flow. New/changed:

- `app/api/speaking-club/my-status/route.ts` — today's assigned shifts +
  which one (if any) is active right now, for the dashboard.
- `app/api/speaking-club/join/route.ts` — validates a typed passkey via
  Phase 1/2's existing `validatePasskey()` (time-window check, §3.4), plus
  a new check that the passkey belongs to *this* signed-in student's own
  assignment (see PHASE3-TESTING.md for why this was added beyond the
  plan's literal wording — flag if it should be reverted).
- `lib/speaking-club-users.ts` — Turso lookup, turns the assigned
  `username1`/`username2` emails into a real display name for the
  dashboard/room UI.
- `lib/speaking-club-db.ts` — added `shiftTimeState()` (done/now/upcoming
  classification), reused by the dashboard's shift schedule list.
- `app/speaking-club/page.tsx` — the old "Preview state" QA switcher is
  gone; the three visual states (waiting / passkey / room-ready) are now
  driven entirely by the real APIs above. Visual design unchanged from
  Phase 0.

**`npx tsc --noEmit` and `eslint` — zero errors/warnings** on every new/
changed file, and the whole project still type-checks clean. **Not tested
against real Supabase/Turso data** (same sandbox network limitation as
Phase 2) — **read `PHASE3-TESTING.md` and run through all 3 test cases**
(no active shift / correct passkey / wrong-expired-not-yours passkey)
before marking this phase done.

**Known gaps, deliberately out of Phase 3's scope** — see
PHASE3-TESTING.md's "Known gaps" section: no live countdown timer, no
server-side gate on the room page itself beyond being signed in (Phase 4's
admin panel is what will actually let someone create assignments through
a UI instead of manual SQL).

## 🆕 Speaking Club Phase 2 (Core Call Flow)

Implements plan §9 Phase 2, on top of the already-locked Phase 1 schema
(`sql/schema.sql`) and Phase 0 designs (`app/speaking-club/*`, unchanged
visually). New files:

- `lib/webrtc/signaling-channel.ts` — one Supabase Realtime channel per
  `room_code`, broadcast offer/answer/ICE + presence tracking (plan §3.1).
- `hooks/use-speaking-room-call.ts` — mesh `RTCPeerConnection` management
  (2 or 3 peers, same code path), deterministic glare-free offer/answer,
  local mic capture + mute, cleanup on leave (plan §3.2, §3.6).
- `lib/webrtc-turn.ts` + `app/api/speaking-club/turn-credentials/route.ts`
  — short-lived Cloudflare Calls TURN credentials, STUN-only fallback if
  unconfigured (plan §3.3).
- `components/speaking-club/remote-audio-sinks.tsx` — plays remote peers'
  audio (hidden `<audio>` per peer).
- `app/speaking-club/room/[code]/page.tsx` — wired to the real call instead
  of Phase 0's mock toggles; the 3-person "Temporary partner" tile now
  renders from real presence instead of a design-QA switch.

**`npx tsc --noEmit` — zero errors**, across the whole project, including
every file above. **Not tested as a live call** — this sandbox can't reach
Supabase Realtime, Cloudflare's TURN API, or a browser mic. **Read
`PHASE2-TESTING.md` and run through all three test cases (2-person,
3-person, forced-TURN) yourself before marking Phase 2 done** — the plan is
explicit that the 2-person case alone isn't sufficient sign-off, since
Phase 5 depends on the 3-person case actually working.

Also added: `CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN` to
`.env.example` (optional — direct P2P still works without them, only the
TURN relay path doesn't).

**Not part of Phase 2, deliberately left for later phases:** passkey/
time-window gated entry into the room (Phase 3), session countdown timer
tied to real shift data (Phase 3), admin panel alerts/reassignment UI
(Phase 4/5), n8n email automation (Phase 6). See PHASE2-TESTING.md's "Known
gaps" section for the full list.

## ✅ Done in this pass

**1. `/contact` — the navbar link went nowhere (404).**
The "Contact" tab in the navbar always pointed to `/contact`, but that
page never existed. Now it does:
- Real info, not placeholders: both phone numbers
  (`+880 1758-594364`, `+880 1522-126566`, as `tel:` links) and the
  Facebook page (opens in a new tab). The footer's "Call Us" numbers were
  still the original `+880 1XXX-XXXXXX` placeholders too — fixed those to
  the same real numbers, and pointed the footer's Facebook icon at the
  real page instead of `#`.
- A working "Send a message" form — validated client + server side,
  emailed to `ADMIN_NOTIFY_EMAIL` via the same `lib/mailer.js` pattern
  already used for password resets and payment claims (new
  `sendContactMessageEmail`, new `POST /api/contact`). Same graceful
  fallback as those: no `RESEND_API_KEY`/`ADMIN_NOTIFY_EMAIL` set →
  it logs the message to the console instead of failing, so the form
  still "works" while developing locally.
- The info cards (Call Us / Message Us / Email) sit just above the
  page's `<Footer />`, per what you asked for.
- Split into a server `app/contact/page.tsx` (has real `metadata` for
  SEO, same pattern as `/about`) + a client `components/contact-content.tsx`
  for the interactive form — not one giant client page.
- While in there: the footer's "About Us" and "Contact" links (Company
  column) and "Member Login" / "Dashboard" (Quick Links column) now go to
  the real `/about`, `/contact`, `/login`, `/mock-test` pages instead of
  `#`; the footer logo now links home (`/`) instead of `#`. Everything
  else in the footer (Programs, Free Resources, Success Stories, Careers,
  Instagram/LinkedIn/YouTube) is untouched — still placeholders, since
  there's genuinely no page/account behind them yet.

**2. Favicon — the site had none, then made circular per feedback.** Browser tabs were falling back to a
generic globe icon since there was no `favicon.ico` or App Router icon
file anywhere. Generated one from the existing `public/logo.svg` mark
(cropped to just the "L" cursive symbol, centered with even padding so it
stays legible at 16px) — added `app/icon.png` (512×512, Next auto-serves
this as the tab favicon via its file-convention, no metadata/layout edit
needed), `app/apple-icon.png` (180×180, for iOS "Add to Home Screen"), and
`public/favicon.ico` (multi-size 16/32/48, the classic fallback some
tools still request directly at `/favicon.ico`). The tab icon
(`app/icon.png` + `favicon.ico`) is now masked to a **transparent circle**
so it reads as a round badge in the browser tab instead of a plain square
— `app/apple-icon.png` deliberately stays a solid square, though, since
iOS applies its own rounded-corner mask to home-screen icons and fills
any transparent pixels with black if you hand it a circle already. No
source files changed.

**3. Build check — better than last time, but still read this before deploying.**
This sandbox has no internet access to third-party domains except a small
allowlist (npm/pip registries, GitHub) — `fonts.googleapis.com` isn't on
it, so `npm run build` fails at the font-fetch step (`next/font` trying to
download Plus Jakarta Sans / Inter), not because of anything in the code.
What I *could* verify for real: `npm install` (clean), and
`npx tsc --noEmit` across the whole project (real type-checker, not a
brace-balance guess). Every file I added or touched type-checks with zero
errors. `tsc` did surface a few **pre-existing** errors unrelated to this
pass (`app/api/admin/attempts/route.ts`, a `useState(undefined)` typing
gap in the old `components/navbar.tsx`, an `ArrayBuffer`/`SharedArrayBuffer`
mismatch in `lib/gemini-live-client.ts`) — none of these are new, none are
in files this pass created, and I didn't touch them. **Please still run
`npm run build` yourself** where real internet access reaches Google
Fonts — that's the one thing this sandbox genuinely can't confirm.

**4. New `/profile` page — the main ask this pass:**
- Reachable by clicking your name/avatar in the navbar (desktop + mobile),
  both now link there instead of being static.
- **Profile picture:** shows the Google avatar that already synced in via
  `avatar_url` (previous pass), but now anyone can also click the camera
  icon to upload their own — picked images are resized/cropped to a
  320×320 JPEG **in the browser** (canvas, no new dependency) before
  upload, so there was no need for a storage bucket or a new upload route;
  it's saved into the same `avatar_url` column Google already uses. A
  "Remove photo" option clears it back to the initials avatar.
- **Name:** editable, saved via `PATCH /api/profile`.
- **Password:** if the account already has one (email/password signup, or
  Google + a password set earlier here), this is a normal change-password
  form — current password checked with bcrypt, same as `/login`. If the
  account is Google-only, it becomes "Set a password" instead (no current
  password to ask for) — a nice side effect is that from then on that
  person can *also* log in with email + password, not just Google.
- **Speaking Club progress:** reuses the exact same stats already on
  `/mock-test` (tests completed, average band score, practice streak) by
  calling the existing `GET /api/mock-test/attempts` — no duplicate logic,
  no new table. Non-members see a "Join Speaking Club" card instead of
  stats that don't apply to them yet.
- New routes: `GET/PATCH /api/profile` (profile read/update — name,
  avatar) and `POST /api/profile/password` (change or first-time-set).
  Both just query the existing `users` table; **no schema change, no new
  migration** — `avatar_url`, `password_hash`, `created_at`, `google_id`
  were all already there.
- Design intentionally matches the site's main premium look (cream/leaf/ink,
  `font-display`/`font-body`, the shared `Card`/`Button` components,
  decorative blurred circles) rather than the separate auth-page or
  mock-test-dashboard CSS files — this felt like an "account home," closer
  in spirit to the marketing pages than to either of those.

## 🔲 Not done / needs your attention

1. **Run `npm run build` somewhere with real internet.** See #3 above —
   this sandbox can't reach Google Fonts, so that step is the one thing
   still genuinely unverified end-to-end.
2. **Contact form needs `RESEND_API_KEY` + `ADMIN_NOTIFY_EMAIL` set to
   actually email you.** Without them it just logs the message to the
   server console instead (same fallback the password-reset and payment
   flows already had) — fine for local dev, but on your real deployment
   make sure both are set in `.env` or nobody's message reaches you.
3. **Avatar storage is a data URL in SQLite/Turso, by design, with a cap.**
   Uploaded photos are capped client-side (320×320, JPEG ~85%) and the
   server also rejects anything over ~1.1MB of image data as a backstop.
   That keeps rows small, but it's still base64 text sitting in a SQLite
   column rather than object storage. Fine at this app's scale; if you
   later want thousands of custom-uploaded avatars, moving this to a
   Storage bucket (like `mock-test-audio` already does for recordings)
   would be the next step — didn't do it speculatively since it needs a
   bucket + signed URLs and isn't needed yet.
4. **Practice Streak** on both `/profile` and `/mock-test` is still the
   same simple heuristic as before (consecutive attempts within ~8 days) —
   unchanged this pass, just reused.

## Two databases — unchanged, still read this before deploying

Accounts use SQLite/Turso; the mock test uses Supabase. Bridged by email
only. See README.md → "Two databases" for the full explanation.
