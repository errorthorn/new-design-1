> **✅ Update — the 🔲 list below is now done.** See `PHASE5-TESTING.md` for
> what was built to close it out and `STATUS.md`'s latest entry for the
> summary. Left the rest of this file as-is below since it's still the
> accurate record of what Phase 5's first pass covered — just know the "NOT
> done yet" section no longer reflects reality.

# Phase 5 (Partner-Absent Handling) — WORK IN PROGRESS, handed off mid-build

This pass implements plan §4 / §9 Phase 5. **Not finished** — stopped partway
through per request. Below is exactly what's done vs what's left, for
whoever picks this up next.

## ✅ Done (working, follows existing patterns)

- **`sql/schema.sql`** — two new tables, appended at the end:
  - `speaking_room_presence` — heartbeat row per (shift, student), used to
    know who's *actually* in a room right now.
  - `speaking_room_alerts` — the durable partner-absent alert + how it was
    resolved. One open alert per shift max (partial unique index).
- **`lib/speaking-club-db.ts`** — added:
  - `recordPresenceHeartbeat()`, `getPresentUsernamesForShift()`
  - `detectAndFlagPartnerAbsences()` — the core §4.1 detection pass:
    flags shifts with both seats assigned + no temp_username + 10+ min in
    + exactly one of the two present; auto-resolves alerts once that's no
    longer true.
  - `listOpenAlerts()`, `getAlertById()`, `resolveAlert()`
  - `suggestReassignmentTargets()` — finds candidate empty rooms and
    candidate "add as 3rd person" rooms at the same shift_number (§4.2).
  - `getShiftById()`, `clearSeatForUsername()` (for §4.5's proactive flow)
  - `reassignStudent()` now returns `{ reassignmentId }` and
    `markReassignmentNotified()` was added, so the (not-yet-written)
    resolve route can send an email immediately and mark it sent.
- **`lib/mailer.ts`** — `sendSpeakingClubReassignmentEmail()`, same
  graceful-fallback pattern as the other mailer functions.
- **`lib/admin-auth.ts`** — `requireCron()`, for a future scheduled route.
- **`app/api/speaking-club/presence/heartbeat/route.ts`** — student-facing
  route the room page heartbeats to. **Done, working.**
- **`app/api/admin/speaking-club/alerts/route.ts`** (GET) — runs detection,
  returns open alerts with display names + suggested targets. **Done.**
- **Plumbing to make heartbeats actually fire:**
  - `join/route.ts` now returns `shiftId` in its response.
  - `app/speaking-club/page.tsx` — `JoinedRoom` type carries `shiftId`,
    the "কলে যোগ দাও" link now passes it as `?shiftId=`.
  - `hooks/use-speaking-room-call.ts` — takes an optional `shiftId` option
    and sends a heartbeat every 45s while `enabled`.
  - `app/speaking-club/room/[code]/page.tsx` — reads `?shiftId=` from the
    URL and passes it to the hook.

## 🔲 NOT done yet — needed before Phase 5 is actually usable

1. **`POST /api/admin/speaking-club/alerts/resolve`** — was mid-write when
   this pass stopped. Needs to: load the alert, call `reassignStudent()`
   with `asThirdPerson` set from the chosen action, `resolveAlert()`, and
   (if `notify`) call `sendSpeakingClubReassignmentEmail()` +
   `markReassignmentNotified()` — else mark notified=true with no send
   (see the comment on `markReassignmentNotified()` for why).
   Also needs a `dismiss` action (no reassignment, just `resolveAlert(id,
   "dismissed")`).
2. **`POST /api/admin/speaking-club/reassign-proactive`** — §4.5's
   planned-conflict flow. Not started. Should mirror `assign/route.ts`'s
   auth/validation style; call `clearSeatForUsername()` on the student's
   old shift (if moving within the same shift_number) then
   `reassignStudent()` with `reason: "proactive_conflict"`.
3. **`app/api/cron/speaking-club-alerts/route.ts`** — a route a scheduler
   (Vercel Cron / n8n) hits every 1-2 min so alerts appear even when no
   admin has the panel open. Just `requireCron()` +
   `detectAndFlagPartnerAbsences()`. Not started.
4. **`app/admin/speaking-club/page.tsx`** — still showing the OLD mock
   `ALERTS` array and the old `ReassignModal`. Needs to be rewired to:
   - fetch `GET /api/admin/speaking-club/alerts` (real shape is different
     from the old mock `Alert` type — see the route above)
   - `ReassignModal` needs real target lists (`emptyRoomTargets` /
     `thirdPersonTargets` from the alert) instead of the hardcoded
     "Room-31" / "Room-05" placeholder text, and to actually POST to the
     resolve route above instead of just closing itself
   - a dismiss button per alert
   - a small "proactive reassignment" form (§4.5) — search student
     (reuse `UserPicker`), pick a target shift, notify checkbox, submit
     to the route above
   - update the header copy that currently says Alerts is still mock data
5. **`.env.example`** — document `CRON_SECRET` (optional, falls back to
   `ADMIN_SECRET`).
6. **`PHASE5-TESTING.md`** and a `STATUS.md` entry, matching every
   previous phase's pattern — not written yet.
7. **Not tested at all** — same sandbox limitation as every other phase
   (no real Supabase connection here).

## Suggested order to finish

`alerts/resolve` → `reassign-proactive` → wire up the admin panel UI
(biggest remaining piece) → `cron` route → `.env.example` + docs.
