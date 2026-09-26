# Phase 5 — Testing Guide (Partner-Absent Handling)

Same caveat as every previous phase: this sandbox has **no network access** to
Supabase/Turso, and this pass additionally had **no `node_modules` and no
network to install one**, so nothing here could be run through `npx tsc` /
`next lint` the way Phase 2-4's docs describe. Everything below was written
by hand-matching the exact patterns, types, and helper signatures already
used elsewhere in this codebase (`lib/speaking-club-db.ts`,
`lib/admin-auth.ts`, `lib/mailer.ts`, the existing `/api/admin/speaking-club/*`
routes) — but it has **not been type-checked or run**. Please run
`npx tsc --noEmit` and `next lint` for real before marking this phase done,
and then work through every test case below against real Supabase/Turso data.

## What was built this pass (completes PHASE5-HANDOFF.md's 🔲 list)

| Handoff item | File |
|---|---|
| 1. `POST /api/admin/speaking-club/alerts/resolve` | `app/api/admin/speaking-club/alerts/resolve/route.ts` |
| 2. `POST /api/admin/speaking-club/reassign-proactive` | `app/api/admin/speaking-club/reassign-proactive/route.ts` |
| 3. `app/api/cron/speaking-club-alerts/route.ts` | new — `GET`/`POST`, `requireCron()` + `detectAndFlagPartnerAbsences()` |
| 4. Admin panel UI wiring | `app/admin/speaking-club/page.tsx` — real `AlertRow` type/state, `loadAlerts()`, 60s poll while the Alerts tab is open, rewritten `ReassignModal` (real targets, dismiss path, calls the resolve route), new `ProactiveReassignForm` |
| 5. `.env.example` — `CRON_SECRET` | done, in the new "Speaking Club (Partner-Absent Handling) — Phase 5" section |
| 6. `PHASE5-TESTING.md` + `STATUS.md` entry | this file + `STATUS.md` |
| 7. Not tested at all | still true — see caveat above |

No changes were needed to `lib/speaking-club-db.ts`, `lib/mailer.ts`, or
`lib/admin-auth.ts` — everything the handoff doc said Phase 5's remaining
routes would need (`getShiftById`, `clearSeatForUsername`,
`markReassignmentNotified`, `sendSpeakingClubReassignmentEmail`,
`requireCron`) was already written in the first pass.

## Setup before testing

Same as Phase 4, plus:
1. `sql/schema.sql` run including the Phase 5 tables at the end
   (`speaking_room_presence`, `speaking_room_alerts`).
2. At least one room+shift assigned to two real Turso accounts (via the
   Assign Students tab) whose shift window covers "now" when you test, so
   you can actually trigger the 10-minute threshold.
3. Optionally set `CRON_SECRET` in `.env.local` to test the cron route with
   its own secret instead of falling back to `ADMIN_SECRET`.

## Test 1 — Alerts tab loads (empty state)

1. Go to `/admin/speaking-club` → **Alerts** tab.
2. **Expected:** "এখন কোনো partner-absent alert নেই" if nothing currently
   qualifies. No console errors.

## Test 2 — Detection actually flags a lonely student

1. Assign a room+shift (Rooms & Shifts or Assign tab) with both seats
   filled, whose shift window includes right now.
2. Have **one** of the two accounts join the room (`/speaking-club/room/...`)
   so `POST /api/speaking-club/presence/heartbeat` starts firing — or insert
   a `speaking_room_presence` row for that username directly for a faster
   test.
3. Wait until `ALERT_THRESHOLD_MINUTES` (10 min) after the shift's
   `start_time`, or temporarily lower that constant in
   `lib/speaking-club-db.ts` for testing.
4. Reload the Alerts tab (or wait up to 60s for the auto-poll).
5. **Expected:** an amber alert card appears — "{Room} (Shift N) — শুধু
   {name} জয়েন করেছে (N+ মিনিট)" with the absent partner's name underneath.

## Test 3 — Reassign into an empty room

1. Make sure at least one other room+shift at the **same shift_number** is
   completely empty (both seats null).
2. Click **Reassign** on the alert from Test 2.
3. **Expected:** modal shows that empty room under "খালি room-এ move" as a
   radio option.
4. Leave "notify" checked, select the empty-room option, click **Confirm
   reassignment**.
5. **Expected:** modal closes, alert list refreshes and the alert is gone
   (or auto-resolves shortly after). Check the server console (or your
   Resend dashboard if `RESEND_API_KEY` is set) — a reassignment email
   should have gone to the previously-lonely student's address with the
   new room/passkey.
6. Check the Rooms & Shifts table — the target room+shift should now show
   the reassigned student in one of its seats, and `speaking_reassignments`
   should have a new row with `reason = 'partner_absent'`.

## Test 4 — Reassign as a 3rd person

1. Repeat Test 2's setup, but this time make sure a *different* active
   room+shift at the same shift_number has both regular seats filled and
   no `temp_username` yet.
2. Open the alert's Reassign modal — **expected:** that room appears under
   "3rd person হিসেবে যোগ".
3. Select it, confirm.
4. **Expected:** that target shift's `temp_username` gets set to the
   reassigned student, and it shows up as "+ {name} (3rd)" in the Rooms &
   Shifts table.

## Test 5 — Dismiss (false positive)

1. Trigger another alert (Test 2).
2. Open its Reassign modal, click **Dismiss** instead of confirming a
   target.
3. **Expected:** modal closes, alert disappears from the list, no email
   sent, `speaking_room_alerts.resolution` is `'dismissed'`.

## Test 6 — No targets available

1. Trigger an alert where there is genuinely no empty room and no
   third-person-eligible room at that shift_number.
2. **Expected:** the modal shows the "কোনো খালি room বা active room পাওয়া
   যায়নি" notice instead of radio options, and **Confirm reassignment** is
   disabled — **Dismiss** still works.

## Test 7 — Stale-target race (409 guard)

1. Open two browser tabs on the Alerts tab, both showing the same alert
   with the same single empty-room target.
2. In tab A, reassign into that target.
3. In tab B (still showing the stale target list), try to confirm the same
   target.
4. **Expected:** tab B gets a 409 with a Bangla "আর খালি seat নেই" /
   "ইতিমধ্যে একজন 3rd person আছে" error instead of silently overwriting tab
   A's assignment.

## Test 8 — Proactive reassignment (§4.5)

1. On the Alerts tab, scroll to **Proactive reassignment**.
2. Search and pick a student (works even if they have no current
   assignment at all).
3. Pick a target room+shift from the dropdown, leave "3rd person" unchecked,
   submit.
4. **Expected:** "Reassign হয়ে গেছে" confirmation; the target shift now
   shows that student in an open seat; if they were previously assigned to
   a *different* room at the **same** shift_number, that old seat is now
   empty (check the Rooms & Shifts table); a reassignment email went out
   (`reason = 'proactive_conflict'` in `speaking_reassignments`).
5. Repeat with a student who has no prior assignment on that shift_number —
   **expected:** same result, just no old seat to clear (no
   `previous_room_code` on the log row).
6. Try picking a fully-assigned target room+shift with "3rd person"
   unchecked — **expected:** 409 error, same as Test 7's guard.

## Test 9 — Cron route auth

1. `curl -i https://your-deployment/api/cron/speaking-club-alerts` with no
   header — **expected:** 401.
2. Same with `-H "x-cron-secret: $CRON_SECRET"` (or `$ADMIN_SECRET` if you
   haven't set `CRON_SECRET`) — **expected:** `{"ok": true}`, and any
   currently-qualifying shift gets an alert opened even without ever
   loading the admin panel.
3. Wire this URL into Vercel Cron (or n8n's schedule trigger) on a 1-2
   minute interval for real use, per plan §4.1/§4.4.

## Known gaps / deliberate scope decisions

- **`alerts/resolve` does not clear the lonely student's seat on the
  original alert's room+shift.** Only `reassign-proactive` does that (via
  `clearSeatForUsername`), because the handoff doc's spec for
  `alerts/resolve` didn't call for it. In practice this is harmless: once
  an alert is marked `resolved`, `detectAndFlagPartnerAbsences()` never
  looks at it again, and the old room's other seat (the truly-absent
  partner) is left as historical record of who was originally paired
  there. If you'd rather the old seat auto-clear too, that's a one-line
  addition to `alerts/resolve` — flagging it here instead of guessing at
  a behavior the handoff didn't specify.
- **The Alerts tab polls every 60s while open**, on top of the cron route —
  this wasn't in the original handoff list but felt necessary so an admin
  watching the tab sees new alerts without manually refreshing; remove the
  `setInterval` effect in `page.tsx` if you'd rather rely on the cron route
  + manual refresh only.
- **Proactive reassignment only clears the student's old seat on the same
  `shift_number`** (the recurring daily slot they're trying to get out of),
  not any other assignment they might have. This matches plan §4.5's
  framing ("reassign them to a different shift/room" — implicitly the one
  they have a conflict with), but if a student could legitimately hold
  multiple different shift_numbers at once and you want this route to
  disambiguate further, that would need a param to specify which old
  assignment to clear.
- **Not tested at all**, per the caveat at the top — same sandbox
  limitation as every previous phase, compounded by no `node_modules`/no
  install this time.
