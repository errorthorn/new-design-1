# Phase 4 — Testing Guide (Admin Panel: Assignment)

Same caveat as Phase 2/3: this sandbox has no network access to Supabase or
Turso, so this has been **type-checked (`npx tsc --noEmit`) and lint-checked
(`npx eslint` / `next lint`) with zero errors/warnings** but **not exercised
against real data**. Please run through this before marking Phase 4 done.

## What was built (plan §9 Phase 4 / §5 items 1-3)

| Plan requirement | File |
|---|---|
| User search/select (existing Turso accounts) | `lib/speaking-club-users.ts` → `searchSpeakingClubUsers()`, `app/api/admin/speaking-club/users/route.ts`, `UserPicker` component in the admin page |
| Room + shift assignment UI (§5.1) | `app/api/admin/speaking-club/assign/route.ts` (+ `assignStudents()`, already existed from Phase 1), `QuickAssignCard` + `ShiftAssignModal` in `app/admin/speaking-club/page.tsx` |
| Bulk assignment / CSV upload (§5.2) | `app/api/admin/speaking-club/bulk-assign/route.ts`, `BulkCsvCard` (client-side CSV parsing — no library, see comment in that component) |
| Auto-pair unassigned button, reviewed and confirmed by admin (§5.2) | `app/api/admin/speaking-club/auto-pair/route.ts` (two-step: proposal, then confirm), `AutoPairCard` |
| Room/shift management table view (§5.3) | `app/api/admin/speaking-club/shifts/route.ts`, `RoomsTab` |

New `lib/speaking-club-db.ts` helpers added for this pass (Phase 1/2/3's
functions — `listAllShifts`, `assignStudents`, `reassignStudent` — were
already there and reused as-is):
- `assignSeat()` — sets one seat (username1 OR username2) without
  clobbering the other. `assignStudents()` replaces both at once (used by
  the single-shift assign modal); `assignSeat()` is for bulk/auto-pair,
  where a row or a pairing pass might only touch one side.
- `getAssignedUsernames()` / `findOpenSeats()` — pure helpers over an
  already-fetched `SpeakingShiftLookup[]`, used by auto-pair to find who's
  unassigned and which seats are open, preferring to pair two fresh
  students into a fully-empty shift before filling a single leftover seat.

`lib/speaking-club-users.ts` additions: `searchSpeakingClubUsers()` (email/
name substring search) and `listSubscribedUsers()` (every
`subscription_active = 1` account — same flag `/admin/members` grants, see
README's "Two databases" note). Both are Turso reads, same pattern as the
existing `getDisplayNamesByEmails()`.

**Deliberately left as Phase 0's mock data, not wired up:** the "Alerts"
tab. Partner-absent detection needs live Realtime presence data (Phase 2)
that this admin-panel pass has no way to test against in this sandbox, and
the plan is explicit that alerts + reassignment are Phase 5's job, not
Phase 4's (§9: "Build this after Phases 2-4 are stable, not before"). The
tab is still there, now labeled "Alerts (Phase 5)", so the layout Phase 0
already designed isn't lost.

## Setup before testing

You'll need:
1. The Phase 1 schema already run (`sql/schema.sql`) — gives you the 50
   seeded rooms × 3 shifts.
2. A few real Turso accounts with `subscription_active = 1` to search for
   and assign. Grant one via `/admin/members` if you don't have any yet.
3. `ADMIN_SECRET` set in your `.env.local` (same one every other `/admin/*`
   page already uses).

## Test 1 — Rooms & Shifts table loads real data

1. Go to `/admin/speaking-club`, enter `ADMIN_SECRET`.
2. **Expected:** the "Rooms & Shifts" tab loads and shows all 50 rooms with
   3 shift columns each, all showing "—" (empty) on a freshly-seeded DB.

## Test 2 — Single room+shift assignment (from the table)

1. Click any shift cell (e.g. Room-01 / Shift 1).
2. **Expected:** a modal opens showing that room+shift's passkey.
3. Type part of a real Turso account's name or email into "Student 1" —
   **expected:** a dropdown appears with matching accounts within ~300ms.
4. Pick one, do the same for "Student 2", click **Save assignment**.
5. **Expected:** modal closes, the table refreshes, and that cell now shows
   both names instead of "—".
6. Re-open the same cell — **expected:** both pickers are pre-filled with
   the names you just assigned (round-trips correctly).

## Test 3 — Single room+shift assignment (from the Assign tab)

1. Go to the "Assign Students" tab.
2. In "একটা room + shift assign করো", pick a *different* room+shift from
   the dropdown (options already assigned show "(assigned)").
3. Search and pick two students, click **Assign করো**.
4. **Expected:** "সেভ হয়েছে" confirmation, and the Rooms & Shifts table
   (if you switch back to it) reflects the change.

## Test 4 — Bulk CSV upload

1. Click "Template ডাউনলোড" — **expected:** downloads a CSV with header
   `room_code,shift_number,username1,username2` and one example row.
2. Edit it: put a few real room codes (`room-05`, `room-06`, ...) and real
   account emails in `username1`/`username2` (leave one blank to test a
   single-seat row).
3. Upload it. **Expected:** a preview table of the parsed rows appears
   with an "X row আপলোড করো" button.
4. Click it. **Expected:** a result summary ("N/M সফল হয়েছে"); any failed
   rows list their reason (e.g. wrong room code, same student twice).
5. **Also test a deliberately bad row:** a `room_code` that doesn't exist,
   and `shift_number` outside 1-3 — **expected:** those rows report an
   error but don't block the valid rows in the same file from succeeding.

## Test 5 — Auto-pair

1. Make sure you have at least 2 `subscription_active = 1` accounts that
   aren't yet in any `speaking_shifts` row (a couple of fresh test
   signups + a manual `/admin/members` grant works).
2. On the "Assign Students" tab, click "Auto-pair চালাও".
3. **Expected:** a proposal table appears (room/shift + the two names it
   would assign) — **nothing is written to the DB yet at this point**.
   Confirm this by checking the Rooms & Shifts table in another tab; it
   should be unchanged.
4. Click **বাতিল** (cancel) once, generate the proposal again, then this
   time click **Confirm করো**.
5. **Expected:** "N-টা assignment হয়ে গেছে", and the Rooms & Shifts table
   now shows those students placed.
6. **Edge case:** run auto-pair again with zero unassigned subscribed
   students left — **expected:** proposal comes back empty
   (`subscribedUnassignedCount: 0`), not an error.

## Known gaps / next steps (explicitly out of Phase 4's scope)

- **No un-assign / clear-seat button** beyond re-opening the assign modal
  and clearing the picker with the × button, then saving — works, just not
  a dedicated "remove" action.
- **Auto-pair doesn't consider "inactive" rooms are already excluded** —
  it is, via `findOpenSeats()`'s `room_status !== "active"` check — but
  there's no UI control to mark a room inactive yet (not part of §5's
  Phase 4 list; would be a small addition if you want it).
- **No pagination on the Rooms & Shifts table** — all 50 rooms render at
  once. Fine at this scale (150 shift rows total), would need revisiting
  well past 50 rooms.
- **Partner-absent alerts + reassignment (Phase 5)** — the "Alerts" tab is
  still Phase 0's static mock data, on purpose. See plan §9 Phase 5.
- **Notification trigger / n8n (Phase 6)** — nothing here emails anyone
  yet. Assigning a student via any of the three flows above does **not**
  send them their passkey — that's Phase 6's job per the plan.
