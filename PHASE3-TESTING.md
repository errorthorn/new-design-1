# Phase 3 — Testing Guide (Student-Facing Access)

Same caveat as Phase 2: this sandbox has no network access to Supabase or
Turso, so this has been **type-checked and lint-checked with zero errors**
but **not exercised against real data**. Please run through this before
marking Phase 3 done.

## What was built

| Plan §9 Phase 3 requirement | File |
|---|---|
| Wire up Phase 0's dashboard design to real data | `app/speaking-club/page.tsx` |
| Passkey entry UI (Phase 0's design) | same file — `PasskeyState` component, now calling a real API instead of accepting any non-empty string |
| Time-window validation logic (§3.4) | `app/api/speaking-club/join/route.ts` → `validatePasskey()` (already existed from Phase 1/2, reused here) |
| Dashboard showing "your current room" once validated | `app/api/speaking-club/my-status/route.ts` + `RoomReadyState` in the dashboard |

New pieces beyond the plan's literal checklist, needed to make the above
actually work against the real schema:
- `lib/speaking-club-users.ts` — turns the `username1`/`username2` email
  strings stored in Supabase back into a display name via a Turso lookup,
  for the "partner name" shown on the dashboard.
- `shiftTimeState()` added to `lib/speaking-club-db.ts` — classifies a
  shift as done/now/upcoming for the schedule list.
- The `/join` route also checks the signed-in user's email against the
  shift's `username1`/`username2`/`temp_username` — the plan's §3.4
  description only mentions the passkey + time-window check, but since a
  passkey is shared by exactly the 2 (or 3) assigned people for that
  room+shift, and the DB already stores who they are, rejecting a
  correct-but-not-yours passkey seemed like a strict improvement worth
  making now rather than a scope change — flag this if it should be
  reverted to match the plan literally.

## Setup before testing

Same as Phase 2's setup, plus: **you need at least one real assignment in
the DB** to test the "shift is active" path. In the Supabase SQL editor:

```sql
-- Find a shift row for the shift number that's currently within its
-- start_time/end_time window in Asia/Dhaka time, or just update one to
-- match right now for testing:
update speaking_shifts
set start_time = (now() at time zone 'Asia/Dhaka')::time - interval '5 minutes',
    end_time   = (now() at time zone 'Asia/Dhaka')::time + interval '55 minutes',
    username1  = 'your-test-account@example.com'  -- must match a real row in Turso `users`
where room_id = (select id from speaking_rooms where room_code = 'room-01')
  and shift_number = 1;
```

Then note that row's `passkey` column value — you'll type it into the
dashboard.

## Test 1 — no shift assigned / not active right now

1. Log in as an account with **no** matching rows in `speaking_shifts`
   (or none active right now).
2. Visit `/speaking-club`.
3. **Expected:** "এখন তোমার কোনো শিফট চলছে না" (waiting state), with either
   an empty-schedule message or today's assigned-but-not-active shifts
   listed as upcoming/done.

## Test 2 — active shift, correct passkey

1. Log in as the account you set as `username1` above.
2. Visit `/speaking-club`.
3. **Expected:** passkey-entry card appears, showing the correct shift
   number and time window.
4. Type the real passkey from that row and submit.
5. **Expected:** switches to the "room ready" card showing the room code
   and (if `username2` is also set) the partner's real name; "কলে যোগ দাও"
   links to `/speaking-club/room/<room_code>` (Phase 2's real call).

## Test 3 — wrong / expired / not-yours passkey

- **Wrong passkey:** type garbage → expect "Passkey-টা ভুল…" (`not_found`).
- **Outside window:** set a shift's `start_time`/`end_time` to a window
  that's already passed, try its passkey → expect "এই সেশনটা এখন চলছে না…"
  (`outside_window`).
- **Not yours:** log in as a *different* account than `username1`/
  `username2`/`temp_username` on that shift, but use the correct passkey →
  expect "এই passkey-টা তোমার আজকের শিফটের জন্য না…" (`not_assigned`).

## Known gaps / next steps (explicitly out of Phase 3's scope)

- **No live countdown timer** on the room-ready card or the in-call screen
  — shows a static "শেষ হবে <time>-এ" instead of a ticking countdown.
  Straightforward to add later (client-side `setInterval` against
  `endTime`), just not required for this phase's deliverable.
- **No re-validation on the room page itself** — `/speaking-club/room/
  [code]` is reachable directly by any signed-in user who knows/guesses a
  room code, without having gone through `/join` first. The intended flow
  (dashboard → passkey → link) is the only *offered* path, but there's no
  server-side gate on the room page itself yet. Consider adding one before
  a real launch, e.g. requiring a short-lived signed token from `/join` to
  load the room page, if this matters for your security bar (Phase 2's
  WebRTC layer only trusts whoever presence puts in the room's signaling
  channel, same gap).
- **Admin panel (Phase 4)** doesn't exist yet, so there's currently no UI
  path to actually create the `username1`/`username2` assignment or set a
  memorable passkey — only the manual SQL above.
