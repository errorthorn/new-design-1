# Speaking Club — Phase 1 Schema Lock

**Status: 🔒 LOCKED — Phase 2 (call flow) and Phase 4 (admin assignment) may start.**

This is the "write the final column names/types here and mark locked"
step from `SPEAKING-CLUB-WEBRTC-PLAN.md` §9. Anyone starting Phase 2 or
Phase 4 should confirm this file still says LOCKED before writing code
against these tables — if a schema change becomes necessary later, it
gets flagged here first (see §9's process), not changed silently.

## Where it lives

Postgres, on the same Supabase project already used for `students` /
`mock_test_attempts` (not the Turso/libSQL `users` DB that holds
login accounts — see `lib/db.ts`). Run `sql/schema.sql` — the
"SPEAKING CLUB" section at the bottom is additive and safe to re-run.

## Decision: normalized, not flat

The plan's §3.5 offered two options. Went with the normalized one — a
`speaking_rooms` table (50 rows, one per room slot) plus a
`speaking_shifts` table (150 rows, one per room × shift) — because the
recurring admin job (reassigning `username1`/`username2` per room per
shift) and the passkey lookup both become single-row `UPDATE`/`SELECT`s
instead of picking the right numbered column out of a flat row.

## Tables

**`speaking_rooms`** — the 50 fixed slots.
| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `room_code` | text, unique | `'room-01'` … `'room-50'` |
| `status` | text | `'active'` \| `'inactive'` |

**`speaking_shifts`** — one row per room per shift (3 per room).
| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `room_id` | uuid, FK → `speaking_rooms` | |
| `shift_number` | smallint | 1, 2, or 3 |
| `passkey` | text, unique | fixed, does not rotate routinely |
| `username1` / `username2` | text, nullable | Turso `users.email` — DB-agnostic link, same pattern as `students.user_email` |
| `start_time` / `end_time` | time | daily recurring window, **Asia/Dhaka local time**, not UTC |
| `temp_username` | text, nullable | emergency 3rd participant (§4.2) |
| `temp_added_at` | timestamptz, nullable | |

**`speaking_reassignments`** — audit log every manual/proactive move
writes to, so Phase 6 (n8n) has a `notified = false` queue to send
emails from and Phase 7 has real reassignment-frequency data.

**`speaking_shift_lookup`** — a view joining the two tables above; this
is what `lib/speaking-club-db.ts` actually queries against.

## Access pattern

Every read/write goes through `lib/speaking-club-db.ts`
(`supabaseServer`, service-role key) from server-side API routes —
same pattern as `lib/mock-test.ts`. RLS is enabled on all three tables
with zero policies (default-deny for the public anon key), matching
`students`/`mock_test_attempts`. The browser's Supabase Realtime
channel (Phase 2 signaling, one per `room_code`) is pub/sub only — it
never queries these tables directly.

## What's seeded already

Running `sql/schema.sql` seeds all 50 `speaking_rooms` and all 150
`speaking_shifts` rows (default windows 5–6pm / 6–7pm / 7–8pm, one
randomly-generated passkey each, `username1`/`username2` left `null`).
Phase 4's admin panel assigns real students into those `null` slots —
the rows already existing is what makes "database is queryable, even
with no UI yet" (the Phase 1 deliverable) true today.

## Query helpers ready for Phase 3/4/5 to build on

`lib/speaking-club-db.ts`: `validatePasskey`, `findShiftsByUsername`,
`findCurrentShiftForUsername`, `listAllShifts`, `assignStudents`,
`reassignStudent`. Typechecked and linted clean against this codebase.
