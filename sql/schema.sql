-- Run this once in the Supabase SQL editor

-- If you already ran an earlier version of this schema (before user_email
-- existed), this line adds the column without touching your existing data.
alter table if exists students add column if not exists user_email text;

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique not null,
  -- Links this row back to the account created by the main site's
  -- login/signup system (a separate database — see lib/db.js). We store
  -- just the email as a simple, DB-agnostic link rather than a foreign key,
  -- since the two systems intentionally use different databases.
  user_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_students_user_email
  on students (user_email);

create table if not exists mock_test_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  transcript text,
  score numeric
);

-- Added for the teacher scoring panel + audio recording feature. Safe to
-- re-run on a database that already has these.
alter table if exists mock_test_attempts add column if not exists feedback text;
alter table if exists mock_test_attempts add column if not exists scored_at timestamptz;
-- Path inside the "mock-test-audio" Storage bucket, e.g. "attempts/<id>.webm"
-- — NOT a public URL. The recording is a student's actual voice, so the
-- bucket is private and both students and teachers only ever get a
-- short-lived signed URL to it (see app/api/mock-test/attempts/audio and
-- app/api/admin/attempts/audio), never a permanent public link.
alter table if exists mock_test_attempts add column if not exists audio_path text;
-- Set by computeEligibility() (lib/mock-test.ts) the first time it notices
-- a "live" (completed_at is null) attempt has sat unfinished past
-- ORPHAN_GRACE_MS — tab closed, browser crashed, connection died. Marking
-- it here (rather than just treating it as harmless in application code)
-- is what lets the unique index below tell "still actually live" apart
-- from "abandoned a while ago" — an abandoned attempt must never count
-- toward the weekly limit (it isn't completed_at, so it never did) AND
-- must never block a fresh attempt from being created.
alter table if exists mock_test_attempts add column if not exists abandoned boolean not null default false;

-- Private storage bucket for the mic + AI examiner recordings. Created here
-- (storage.buckets is a normal table you can insert into) so it exists
-- right after running this file, instead of a manual dashboard step.
-- public = false is deliberate — see the audio_path comment above.
insert into storage.buckets (id, name, public)
values ('mock-test-audio', 'mock-test-audio', false)
on conflict (id) do nothing;
-- No storage.objects RLS policies are added because every upload/read goes
-- through the server using SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS —
-- consistent with how the rest of this schema is accessed from Next.js.

-- Fast lookup of "did this student already test this week"
create index if not exists idx_attempts_student_started
  on mock_test_attempts (student_id, started_at desc);

-- Defense-in-depth against a double-click / double-tab race: the app
-- already checks computeEligibility() before creating an attempt, but
-- that check-then-insert isn't atomic — two near-simultaneous requests
-- from the same student could both pass the check before either insert
-- lands, creating two "live" attempts. This partial unique index makes
-- the database itself refuse the second one (Postgres error 23505), which
-- app/api/mock-test/gemini-session/route.ts now catches and turns into
-- the same friendly "already in progress" message instead of a raw 500.
-- The `abandoned = false` condition is what keeps this from ever
-- conflicting with the orphan-grace-period feature — see the `abandoned`
-- column comment above.
--
-- ⚠️ BEFORE RUNNING THIS ON AN EXISTING DATABASE: creating a unique index
-- fails if any student currently has more than one row with
-- completed_at is null. Check first with:
--   select student_id, count(*) from mock_test_attempts
--   where completed_at is null group by student_id having count(*) > 1;
-- If that returns any rows, decide per-row whether to mark the older
-- one(s) completed_at = now() or delete them before running this index.
create unique index if not exists idx_one_live_attempt_per_student
  on mock_test_attempts (student_id)
  where completed_at is null and abandoned = false;

-- Teacher-authored questions. The Live session is instructed to ask
-- only from this list, in order, one at a time — grouped by IELTS-style
-- part (1 = intro Q&A, 2 = single cue-card topic, 3 = follow-up
-- discussion tied to the Part 2 topic).
create table if not exists mock_test_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  part smallint not null default 1, -- 1, 2, or 3
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Safe to re-run on a database where the table already existed before
-- `part` was introduced — every existing row defaults to Part 1.
alter table mock_test_questions add column if not exists part smallint not null default 1;

create index if not exists idx_questions_active_part_position
  on mock_test_questions (active, part, position);

-- The week's Part 1 topic — shown to the student on the session page
-- itself (not part of the spontaneity-sensitive question bank above),
-- so an admin can set something like "Your hometown" and the student
-- sees it framed nicely before/during Part 1. Single-row settings table:
-- id is pinned to 1, admin overwrites the same row each week.
create table if not exists mock_test_topic (
  id smallint primary key default 1,
  topic text not null default '',
  updated_at timestamptz not null default now(),
  constraint mock_test_topic_single_row check (id = 1)
);
insert into mock_test_topic (id, topic)
values (1, '')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Study materials (members-only page). A "box" is an admin-created category
-- shown on /study-materials — e.g. "Daily Topic Vocabulary", "Weekly
-- Problem-Solving Class", "Free Speaking Resources". Each box holds "items",
-- which is where the actual weekly content goes (text, a recorded-class
-- link, and/or an uploaded PDF). Membership gating happens separately in the
-- Next.js app (users.subscription_active, in the Turso/libSQL users table,
-- not here) — this table only holds the content itself.
-- ---------------------------------------------------------------------------
create table if not exists material_boxes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'resource', -- 'vocabulary' | 'class' | 'resource' — drives the icon on the page
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- One row per week (or per free resource) inside a box. `body` is plain
-- text/markdown (e.g. the vocab list itself), `video_url` is an external
-- link (e.g. YouTube/Drive) to a recorded class, and `file_path`/`file_name`
-- point at an uploaded PDF in the `study-materials` Storage bucket below.
-- All three content fields are optional and independent — an item can be
-- text-only, a link-only, a file-only, or any combination.
create table if not exists material_items (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references material_boxes(id) on delete cascade,
  title text not null,
  body text,
  video_url text,
  file_path text,
  file_name text,
  published boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_material_items_box_position
  on material_items (box_id, position);

-- Private bucket for admin-uploaded PDFs (slides, free resources). Same
-- reasoning as mock-test-audio above: public = false, members only ever get
-- a short-lived signed URL (see app/study-materials/page.tsx and
-- app/api/admin/material-items/upload-url), never a permanent public link.
insert into storage.buckets (id, name, public)
values ('study-materials', 'study-materials', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Quiz. A "quiz" is an admin-created set of MCQ questions (typically one
-- per Problem Solving Class, though nothing here enforces that link yet —
-- keeping it a standalone, admin-published set is enough for the first
-- version). Members see only published quizzes; each quiz can be attempted
-- once (see quiz_attempts) and the score/answers stay visible afterward.
-- ---------------------------------------------------------------------------
create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  time_limit_minutes integer, -- null = untimed
  published boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- Mistake-review quiz gap-fix: an admin asked for a quiz that regenerates
-- itself from the pool of Speaking Club mistake_logs (source =
-- 'speaking_club') so quiz practice stays tied to what students are
-- actually getting wrong in live conversation, not a fixed hand-written
-- set. `auto_source` identifies which generator owns a quiz's questions
-- ('speaking_club_mistakes' is the only value today, kept as a plain
-- text column rather than a check constraint so a future generator can
-- reuse this same column without a migration); a manually-created quiz
-- (the original, still-supported flow above) simply leaves it null.
-- lib/mistake-quiz-generator.ts is the only writer of these three
-- columns — the admin quiz UI (app/admin/quiz/page.tsx) only ever reads
-- them to show a badge, never edits them directly.
alter table if exists quizzes add column if not exists auto_source text;
alter table if exists quizzes add column if not exists auto_generated_at timestamptz;
alter table if exists quizzes add column if not exists auto_mistakes_analyzed integer;

create index if not exists idx_quizzes_published_position
  on quizzes (published, position);

-- One MCQ per row. `options` is a JSON array of option strings (4 is the
-- expected/admin-UI-enforced count, but nothing in the schema hardcodes
-- that in case a 2/3/5-option question is ever needed). `correct_index`
-- is 0-based into `options`.
create table if not exists quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  question text not null,
  options jsonb not null,
  correct_index smallint not null,
  explanation text,
  position integer not null default 0,
  -- Optional reading passage shown alongside the question in the SAT-style
  -- split-pane quiz layout. Null/blank means the question renders full-width
  -- with no left-hand passage panel.
  passage text,
  created_at timestamptz not null default now()
);

-- Safe to re-run: adds the column to an already-existing table without
-- touching the create-table-if-not-exists block above.
alter table quiz_questions add column if not exists passage text;

create index if not exists idx_quiz_questions_quiz_position
  on quiz_questions (quiz_id, position);

-- One row per (quiz, student) attempt. `user_email` is the same
-- DB-agnostic link used elsewhere (speaking_shifts.username1, students.user_email)
-- back to the main Turso `users` table, rather than a foreign key, since
-- Supabase and Turso are separate databases. `answers` is a JSON object of
-- { [question_id]: selected_index }, kept so a student can review exactly
-- what they picked, not just the final score.
create table if not exists quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  user_email text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  score integer,
  total_questions integer,
  answers jsonb,
  created_at timestamptz not null default now()
);

-- One attempt per (quiz, student) — retakes aren't supported in this first
-- version, so the API upserts on this pair instead of allowing duplicates.
create unique index if not exists idx_quiz_attempts_one_per_student
  on quiz_attempts (quiz_id, user_email);

create index if not exists idx_quiz_attempts_email
  on quiz_attempts (user_email);

-- SECURITY: same default-deny posture as the tables above — every
-- read/write goes through the server (supabaseServer, service role) from
-- the /api/quiz/* and /api/admin/quizzes /api/admin/quiz-questions routes,
-- never queried directly with the anon key from the browser.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename in ('quizzes', 'quiz_questions', 'quiz_attempts')
  loop
    execute format('drop policy if exists %I on %I', pol.policyname, pol.tablename);
  end loop;
end $$;

alter table quizzes enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- Homepage testimonials ("Members say" section). Admin-managed via
-- /admin/testimonials so real member quotes + photos can replace the
-- placeholder ones in components/testimonials.tsx without a code deploy.
-- ---------------------------------------------------------------------------
create table if not exists testimonials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  quote text not null,
  avatar_path text,
  rating integer not null default 5,
  published boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- Safe to re-run: adds the column if an earlier version of this schema
-- already created the table without it. Rating is validated as 1–5 in the
-- admin API route rather than a DB constraint, so this file stays
-- re-runnable without a DO block.
alter table if exists testimonials add column if not exists rating integer not null default 5;

create index if not exists idx_testimonials_published_position
  on testimonials (published, position);

-- Public bucket (unlike mock-test-audio/study-materials above) because
-- these photos are shown on the public marketing homepage — the browser
-- needs a permanent, non-expiring public URL, not a short-lived signed one.
insert into storage.buckets (id, name, public)
values ('testimonial-avatars', 'testimonial-avatars', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- SECURITY: no permissive anon RLS policies here on purpose. This app is the
-- Next.js version — every read/write to `students` and `mock_test_attempts`
-- goes through the server (supabaseServer, using SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS entirely) after requireActiveMember()/computeEligibility()
-- checks. Enabling RLS with zero policies below means the anon key (which is
-- public — it ships in the browser bundle) gets a hard default-deny on these
-- two tables, as defense-in-depth in case it's ever queried directly by
-- mistake. An earlier version of this schema had `using (true)` policies
-- here (anyone with the anon key could read/insert freely) — that's been
-- removed; do not re-add permissive policies without a real reason.
-- ---------------------------------------------------------------------------
-- Drop any policies that already exist on these two tables before
-- (re-)enabling RLS below. Enabling RLS does NOT remove existing
-- policies — if this file is re-run on a Supabase project that was
-- ever set up with an earlier version of this schema (the one with
-- permissive `using (true)` policies, see PROJECT-HANDOVER.md), those
-- old policies stay active unless explicitly dropped. This loop drops
-- whatever is currently attached to `students`/`mock_test_attempts` by
-- name, so it self-heals on re-run without needing to know in advance
-- what those old policies were called. Safe/idempotent: does nothing
-- on a project that has no policies on these tables yet.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'students'
  loop
    execute format('drop policy if exists %I on students', pol.policyname);
  end loop;

  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'mock_test_attempts'
  loop
    execute format('drop policy if exists %I on mock_test_attempts', pol.policyname);
  end loop;
end $$;

alter table students enable row level security;
alter table mock_test_attempts enable row level security;

-- =============================================================================
-- SPEAKING CLUB (WebRTC 1v1 groups) — Phase 1: Data Foundation
-- See SPEAKING-CLUB-WEBRTC-PLAN.md (§3.5, §9 Phase 1) for the full design.
-- Normalized form chosen over the flat "shift1_passkey, shift2_passkey..."
-- alternative — cleaner for querying/updating individual shifts.
-- =============================================================================

-- 50 fixed room "slots", reused across all 3 daily shifts (not one room per
-- student — see plan §2).
create table if not exists speaking_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null, -- e.g. 'room-07'
  status text not null default 'active', -- 'active' | 'inactive'
  created_at timestamptz not null default now()
);

-- One row per room per shift (3 rows per room, 150 rows total at 50 rooms).
-- Passkeys are fixed per room+shift and do NOT rotate routinely — only the
-- username1/username2 assignment changes on the admin's recurring cycle
-- (plan §3.4).
create table if not exists speaking_shifts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references speaking_rooms(id) on delete cascade,
  shift_number smallint not null check (shift_number in (1, 2, 3)),
  passkey text unique not null, -- e.g. 'LC-R07-S1-A8X2'

  -- DB-agnostic link to the main site's account (Turso `users.email` —
  -- see lib/db.ts), same pattern as students.user_email above rather than
  -- a foreign key, since Supabase and Turso are separate databases.
  username1 text,
  username2 text,

  -- Daily recurring window, not tied to a calendar date — e.g. 17:00–18:00.
  -- IMPORTANT: compare against Asia/Dhaka local time, not UTC/server time,
  -- when doing the time-window validation described in plan §3.4:
  --   (now() at time zone 'Asia/Dhaka')::time between start_time and end_time
  start_time time not null,
  end_time time not null,

  -- Emergency 3rd participant for this room+shift (plan §4.2) — set by the
  -- admin's manual reassignment action, cleared once the shift ends.
  temp_username text,
  temp_added_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, shift_number),
  check (end_time > start_time)
);

-- "Given a username or passkey, which room/shift do they belong to" —
-- the Phase 1 deliverable from plan §9.
create index if not exists idx_speaking_shifts_username1 on speaking_shifts (username1);
create index if not exists idx_speaking_shifts_username2 on speaking_shifts (username2);
create index if not exists idx_speaking_shifts_temp_username on speaking_shifts (temp_username);
-- passkey and (room_id, shift_number) already have unique indexes from above.

-- Convenience view joining room + shift for the common "look this passkey /
-- room_code up" query — used by lib/speaking-club-db.ts.
create or replace view speaking_shift_lookup as
select
  sh.id as shift_id,
  sh.passkey,
  sh.shift_number,
  sh.start_time,
  sh.end_time,
  sh.username1,
  sh.username2,
  sh.temp_username,
  r.id as room_id,
  r.room_code,
  r.status as room_status
from speaking_shifts sh
join speaking_rooms r on r.id = sh.room_id;

-- Audit log of every reassignment (both the reactive partner-absent flow,
-- §4.2, and the proactive pre-notified-conflict flow, §4.5). n8n's Phase 6
-- notification workflow reads rows where notified = false, sends the
-- email, then flips it to true — giving Phase 6 something concrete to
-- trigger off of, and Phase 7 a history to audit real reassignment
-- frequency against.
create table if not exists speaking_reassignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references speaking_shifts(id) on delete cascade,
  student_username text not null,
  reason text not null check (reason in ('partner_absent', 'proactive_conflict')),
  previous_room_code text,
  previous_shift_number smallint,
  new_room_code text not null,
  new_shift_number smallint not null,
  notified boolean not null default false,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_speaking_reassignments_notified
  on speaking_reassignments (notified) where notified = false;

-- Keeps speaking_shifts.updated_at accurate on every UPDATE (admin
-- reassigning username1/2, or setting/clearing temp_username) — nothing in
-- this app relied on a trigger like this before, so it's defined here
-- rather than reused from elsewhere.
create or replace function set_speaking_shifts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_speaking_shifts_updated_at on speaking_shifts;
create trigger trg_speaking_shifts_updated_at
  before update on speaking_shifts
  for each row execute function set_speaking_shifts_updated_at();

-- SECURITY: same default-deny posture as students/mock_test_attempts above
-- — every read/write goes through the server (supabaseServer, service
-- role) from lib/speaking-club-db.ts and the /api/speaking-club/* routes,
-- never queried directly with the anon key from the browser. Enabling RLS
-- with zero policies means the public anon key gets a hard default-deny,
-- as defense-in-depth in case it's ever queried directly by mistake.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename in ('speaking_rooms', 'speaking_shifts', 'speaking_reassignments')
  loop
    execute format('drop policy if exists %I on %I', pol.policyname, pol.tablename);
  end loop;
end $$;

alter table speaking_rooms enable row level security;
alter table speaking_shifts enable row level security;
alter table speaking_reassignments enable row level security;

-- Seed the 50 room slots (room-01 .. room-50). Safe to re-run — room_code
-- is unique, so existing rooms are left untouched.
insert into speaking_rooms (room_code)
select 'room-' || lpad(n::text, 2, '0')
from generate_series(1, 50) as n
on conflict (room_code) do nothing;

-- Seed 3 empty shift rows (no passkey yet) per room, at the default times
-- from the plan (§3.4 example: 5–6pm / 6–7pm / 7–8pm). Passkeys are left
-- for the admin to generate on first real assignment — this just gets the
-- 150 rows into existence so "database is queryable" (Phase 1 deliverable)
-- holds true immediately, with no UI yet.
insert into speaking_shifts (room_id, shift_number, passkey, start_time, end_time)
select
  r.id,
  s.shift_number,
  'LC-' || upper(replace(r.room_code, 'room-', 'R')) || '-S' || s.shift_number || '-' ||
    upper(substr(md5(r.room_code || s.shift_number::text || random()::text), 1, 4)),
  s.start_time,
  s.end_time
from speaking_rooms r
cross join (
  values
    (1, time '17:00', time '18:00'),
    (2, time '18:00', time '19:00'),
    (3, time '19:00', time '20:00')
) as s(shift_number, start_time, end_time)
where not exists (
  select 1 from speaking_shifts sh
  where sh.room_id = r.id and sh.shift_number = s.shift_number
);

-- =============================================================================
-- SPEAKING CLUB — Phase 5: Partner-Absent Handling
-- See SPEAKING-CLUB-WEBRTC-PLAN.md (§4, §9 Phase 5) for the full design.
-- Two new tables:
--   1. speaking_room_presence — a lightweight heartbeat row per (shift,
--      student), written by the browser every ~45s while actually in a
--      call (hooks/use-speaking-room-call.ts). This is what lets a
--      stateless server-side check (a Next.js API route, called on a
--      schedule) answer "who is *actually* in this room right now"
--      without needing a live websocket connection into Supabase
--      Realtime's in-memory presence state itself.
--   2. speaking_room_alerts — the durable "Room-12 — only Karim joined"
--      alert row the admin panel's Alerts tab reads/resolves, and the
--      audit trail of how each one was resolved.
-- =============================================================================

-- One row per (shift, student) currently/recently in that room's call.
-- Upserted on every heartbeat; `last_seen_at` is what "present right now"
-- means (see PRESENCE_STALE_SECONDS in lib/speaking-club-db.ts) — this
-- table is intentionally NOT an append-only log, just a rolling "last
-- seen" marker, so it stays small (at most 3 rows per shift) no matter
-- how long the app runs.
create table if not exists speaking_room_presence (
  shift_id uuid not null references speaking_shifts(id) on delete cascade,
  username text not null, -- Turso users.email — same "DB-agnostic link" as speaking_shifts.username1/2
  last_seen_at timestamptz not null default now(),
  primary key (shift_id, username)
);

create index if not exists idx_speaking_room_presence_last_seen
  on speaking_room_presence (last_seen_at);

-- The partner-absent alert itself (plan §4.1). `present_username` is the
-- lonely student who showed up — the one Phase 5's reassignment action
-- actually moves (plan §4.2: "move the lonely student"). `absent_username`
-- is who didn't show, kept for the admin panel's display text only.
create table if not exists speaking_room_alerts (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references speaking_shifts(id) on delete cascade,
  room_code text not null,
  shift_number smallint not null,
  present_username text not null,
  absent_username text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('moved_empty_room', 'added_third_person', 'dismissed', 'auto_resolved')),
  resolved_at timestamptz,
  detected_at timestamptz not null default now()
);

-- Only one OPEN alert per shift at a time — detectAndFlagPartnerAbsences()
-- (lib/speaking-club-db.ts) checks this before inserting, but the partial
-- unique index is the real guarantee against a double-flag from two
-- overlapping detection runs (e.g. the admin panel's own GET /alerts call
-- racing a scheduled cron hit).
create unique index if not exists idx_speaking_room_alerts_one_open_per_shift
  on speaking_room_alerts (shift_id) where status = 'open';

create index if not exists idx_speaking_room_alerts_status
  on speaking_room_alerts (status) where status = 'open';

-- SECURITY: same default-deny posture as the Phase 1 tables above — every
-- read/write goes through the server (supabaseServer, service role) from
-- lib/speaking-club-db.ts, never queried directly with the anon key.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename in ('speaking_room_presence', 'speaking_room_alerts')
  loop
    execute format('drop policy if exists %I on %I', pol.policyname, pol.tablename);
  end loop;
end $$;

alter table speaking_room_presence enable row level security;
alter table speaking_room_alerts enable row level security;

-- =============================================================================
-- SPEAKING CLUB — Phase 7: Monitoring & Hardening
-- See SPEAKING-CLUB-WEBRTC-PLAN.md (§7, §9 Phase 7) for the full design.
--
-- One row per participant per call, written by the browser (best-effort,
-- via navigator.sendBeacon with a fetch fallback — see
-- hooks/use-speaking-room-call.ts) when a call ends. This is the concrete
-- form of plan §7's "log TURN usage via getStats() for the first 1-2
-- weeks" recommendation: rather than trusting the §7 estimate (~40-60
-- GB/month realistic, ~202 GB/month worst case) against Cloudflare's free
-- 1TB/month quota, this table lets the admin panel's Monitoring tab show
-- the REAL relay-vs-direct ratio and real bytes relayed once the feature
-- is actually live with real students on real home-wifi NATs.
--
-- Deliberately a flat append-only log (unlike speaking_room_presence's
-- rolling upsert) — at the scale here (max ~300 calls/day, 2-3 rows per
-- call) this stays small for a very long time, and an append-only log is
-- what "watch real usage for 1-2 weeks, then decide" actually needs: the
-- Monitoring tab aggregates it by day, but nothing is ever overwritten.
create table if not exists speaking_turn_usage (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references speaking_shifts(id) on delete set null,
  room_code text not null,
  shift_number smallint,
  username text not null, -- Turso users.email — same pattern as speaking_shifts.username1/2
  used_relay boolean not null default false, -- true if the SELECTED candidate pair's local candidate was type 'relay' (i.e. this peer needed TURN, not just direct P2P)
  relay_bytes_sent bigint not null default 0,
  relay_bytes_received bigint not null default 0,
  call_duration_seconds integer not null default 0,
  peer_count integer not null default 2, -- 2 (normal) or 3 (plan §4.2 emergency 3rd participant) — lets Phase 7 see whether 3-person rooms move the needle on TURN usage, per plan §7's note that they do so "marginally"
  created_at timestamptz not null default now()
);

create index if not exists idx_speaking_turn_usage_created_at on speaking_turn_usage (created_at);
create index if not exists idx_speaking_turn_usage_relay on speaking_turn_usage (used_relay) where used_relay = true;

-- SECURITY: same default-deny posture as every other Speaking Club table —
-- every read/write goes through the server (supabaseServer, service role)
-- from lib/speaking-club-db.ts, never queried directly with the anon key.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename in ('speaking_turn_usage')
  loop
    execute format('drop policy if exists %I on %I', pol.policyname, pol.tablename);
  end loop;
end $$;

alter table speaking_turn_usage enable row level security;

-- ---------------------------------------------------------------------------
-- Community — Doubts & Q&A. A student posts a question, anyone can reply,
-- and the original poster can mark one reply as the accepted answer (which
-- also flips the question to 'solved'). Deliberately NOT tagged by a rigid
-- SAT domain/skill taxonomy — nothing else in this schema tags content that
-- way either (see quiz_questions), so `topic` is just a free-text label the
-- poster can optionally add (e.g. "Reading", "Math").
--
-- author_name / author_avatar_url are snapshotted at post time — same
-- denormalization the rest of this schema uses (e.g. testimonials) since the
-- real profile lives in the separate Turso `users` table, not here. A later
-- profile-name change won't rewrite old posts; fine for a doubt board.
-- ---------------------------------------------------------------------------
create table if not exists community_questions (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  author_name text not null,
  author_avatar_url text,
  title text not null,
  body text not null,
  topic text,
  status text not null default 'open' check (status in ('open', 'solved')),
  accepted_answer_id uuid,
  upvotes integer not null default 0,
  answer_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_community_questions_created
  on community_questions (created_at desc);
create index if not exists idx_community_questions_user_email
  on community_questions (user_email);
create index if not exists idx_community_questions_status
  on community_questions (status);

create table if not exists community_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references community_questions(id) on delete cascade,
  user_email text not null,
  author_name text not null,
  author_avatar_url text,
  body text not null,
  is_accepted boolean not null default false,
  upvotes integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_community_answers_question
  on community_answers (question_id, created_at);

-- Added after both tables exist, so the FK can point at community_answers.
-- Guarded with a pg_constraint check since Postgres has no
-- "ADD CONSTRAINT IF NOT EXISTS" — this keeps the file safely re-runnable
-- like the rest of it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'community_questions_accepted_answer_fkey'
  ) then
    alter table community_questions
      add constraint community_questions_accepted_answer_fkey
      foreign key (accepted_answer_id) references community_answers(id) on delete set null;
  end if;
end $$;

-- One row per (user, target) vote so a user can only upvote a given
-- question/answer once, and the API can tell "already voted" apart from a
-- fresh vote. No downvotes — a doubt board only needs "this helped me too".
create table if not exists community_votes (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  target_type text not null check (target_type in ('question', 'answer')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_email, target_type, target_id)
);

create index if not exists idx_community_votes_target
  on community_votes (target_type, target_id);
create index if not exists idx_community_votes_user
  on community_votes (user_email);

-- SECURITY: same default-deny posture as every other table in this file —
-- every read/write goes through the server (supabaseServer, service role)
-- from lib/community-db.ts / app/api/community/*, never queried directly
-- with the anon key from the browser.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('community_questions', 'community_answers', 'community_votes')
  loop
    execute format('drop policy if exists %I on %I', pol.policyname, pol.tablename);
  end loop;
end $$;

alter table community_questions enable row level security;
alter table community_answers enable row level security;
alter table community_votes enable row level security;

-- ---------------------------------------------------------------------------
-- Problem Solving Classes (members-only /dashboard/classes page). A single
-- table covers both forms the dashboard needs, distinguished by `type`:
--   'live'     — a scheduled session with a join link (Zoom/Meet/etc),
--                 shown under "Upcoming" while scheduled_at is in the future.
--   'recorded' — a past session's recording, shown under "Recordings".
-- Kept as one table (not two) since both are just "a class" from the
-- content-management side, same pattern as material_boxes/material_items
-- using a `type` discriminator above. Membership gating happens in the
-- Next.js app via requireActiveMember(), same as quizzes — this table only
-- holds the content itself.
-- ---------------------------------------------------------------------------
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type text not null default 'live' check (type in ('live', 'recorded')),
  -- 'live': when the session happens. 'recorded': when it originally ran
  -- (optional — lets recordings still sort chronologically).
  scheduled_at timestamptz,
  duration_minutes integer,
  -- 'live': the Zoom/Meet/etc join link. 'recorded': left null.
  meeting_url text,
  -- 'recorded': the recording link (YouTube/Drive/etc). 'live': left null
  -- until the admin adds it after the session, at which point flipping
  -- `type` to 'recorded' moves it into the Recordings list automatically.
  video_url text,
  published boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_classes_type_scheduled
  on classes (type, scheduled_at);
create index if not exists idx_classes_published_position
  on classes (published, position);

-- SECURITY: same default-deny posture as quizzes/testimonials above — every
-- read/write goes through the server (supabaseServer, service role) from
-- /api/classes and /api/admin/classes, never queried directly with the
-- anon key from the browser.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'classes'
  loop
    execute format('drop policy if exists %I on classes', pol.policyname);
  end loop;
end $$;

alter table classes enable row level security;

-- ---------------------------------------------------------------------------
-- Class Notes (members-only /dashboard/class-notes page). Each row is one
-- note/material attached to a class — either pasted text (`content`) or a
-- link to an uploaded file/doc (`file_url`), or both. Same content-management
-- shape as `classes` right above (admin authors it via /admin/class-notes,
-- members only ever see published rows), so this reuses the identical
-- pattern on purpose rather than introducing a new shape.
-- ---------------------------------------------------------------------------
create table if not exists class_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  content text,
  file_url text,
  published boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_class_notes_published_position
  on class_notes (published, position);

-- SECURITY: same default-deny posture as classes/quizzes/testimonials above —
-- every read/write goes through the server (supabaseServer, service role)
-- from /api/class-notes and /api/admin/class-notes, never queried directly
-- with the anon key from the browser.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'class_notes'
  loop
    execute format('drop policy if exists %I on class_notes', pol.policyname);
  end loop;
end $$;

alter table class_notes enable row level security;

-- ---------------------------------------------------------------------
-- Self-healing counters for community_questions.answer_count / .upvotes
-- and community_answers.upvotes.
--
-- These two columns used to be maintained by hand in application code
-- (lib/community-db.ts: createAnswer() incremented answer_count,
-- toggleVote() incremented/decremented upvotes). That only stays correct
-- if EVERY row is written through those functions — a row added any
-- other way (seeding demo data by hand in the Supabase table editor, a
-- one-off SQL fix, a future script) silently leaves the counter wrong,
-- and it stays wrong forever since nothing ever recomputes it.
--
-- These triggers make the columns correct by construction instead:
-- every insert/delete on community_answers or community_votes
-- recalculates the affected counter directly from a COUNT(*) of the real
-- rows, in the same transaction as the write. It doesn't matter whether
-- that write came from the app, the table editor, or a bulk import.
-- Re-run this file any time — it's safe (create-or-replace / drop-if-
-- exists throughout), same as everything above it.
create or replace function sync_community_answer_count()
returns trigger as $$
begin
  update community_questions
    set answer_count = (
      select count(*) from community_answers
      where question_id = coalesce(NEW.question_id, OLD.question_id)
    )
    where id = coalesce(NEW.question_id, OLD.question_id);
  return coalesce(NEW, OLD);
end;
$$ language plpgsql;

drop trigger if exists trg_sync_community_answer_count on community_answers;
create trigger trg_sync_community_answer_count
after insert or delete on community_answers
for each row execute function sync_community_answer_count();

create or replace function sync_community_vote_count()
returns trigger as $$
declare
  t_type text := coalesce(NEW.target_type, OLD.target_type);
  t_id uuid := coalesce(NEW.target_id, OLD.target_id);
begin
  if t_type = 'question' then
    update community_questions
      set upvotes = (
        select count(*) from community_votes
        where target_type = 'question' and target_id = t_id
      )
      where id = t_id;
  elsif t_type = 'answer' then
    update community_answers
      set upvotes = (
        select count(*) from community_votes
        where target_type = 'answer' and target_id = t_id
      )
      where id = t_id;
  end if;
  return coalesce(NEW, OLD);
end;
$$ language plpgsql;

drop trigger if exists trg_sync_community_vote_count on community_votes;
create trigger trg_sync_community_vote_count
after insert or delete on community_votes
for each row execute function sync_community_vote_count();

-- One-time repair: fixes any row whose stored counter has already
-- drifted from reality (e.g. demo rows added by hand before the
-- triggers above existed). Safe to re-run — it's just a recompute, not
-- an increment, so running it twice gives the same correct answer both
-- times. New rows going forward stay correct automatically via the
-- triggers above; this statement is only needed once for old data.
update community_questions q
  set answer_count = (select count(*) from community_answers a where a.question_id = q.id);

update community_questions q
  set upvotes = (
    select count(*) from community_votes v
    where v.target_type = 'question' and v.target_id = q.id
  );

update community_answers a
  set upvotes = (
    select count(*) from community_votes v
    where v.target_type = 'answer' and v.target_id = a.id
  );

-- =============================================================================
-- SPEAKING CLUB — AI Feedback + Categorized Mistake Log — Phase A (Schema)
-- See SPEAKING-CLUB-AI-FEEDBACK-PLAN.md §4 for the full design.
--
-- Two tables, deliberately kept separate from speaking_shifts (that table
-- is room/access logic, not feedback content):
--   1. speaking_feedback — "what the student sees": one row per finished
--      session, holding the overall AI-generated summary + a status the
--      Phase D background worker moves through pending -> processing ->
--      done/failed.
--   2. mistake_logs — "what mentors query": many rows per session (one
--      per individual mistake the AI found), tagged by `source` so this
--      table can later hold mock_test mistakes too (§7.1, future work)
--      without a speaking_club mentor's filtered view ever seeing them
--      mixed in. `source` is enforced at the database level via a check
--      constraint, not just app-level convention.
-- =============================================================================

create table if not exists speaking_feedback (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid references speaking_shifts(id) on delete set null,

  -- DB-agnostic link to the main site's account (Turso `users.email`),
  -- same pattern as speaking_shifts.username1/2 above rather than a
  -- foreign key, since Supabase and Turso are separate databases.
  student_username text not null,

  -- ⚠️ Gap-fix vs the original plan's §4 schema listing, added here in
  -- Phase C: the plan never actually gave the Phase D background worker
  -- anywhere to read the transcript FROM once Phase C creates this row —
  -- §4's table listing omitted it. Same role as mock_test_attempts.transcript
  -- above (this codebase already has that exact precedent). Set once, by
  -- Phase C's ingestion endpoint; Phase D reads it, never modifies it.
  transcript text,

  -- Gap-fix: neither the original plan nor Phase C ever captured WHICH
  -- topic/cue-cards were active during the call, so the Phase D worker
  -- had no way to tell Gemini what the pair was supposed to be talking
  -- about — the prompt was fully topic-agnostic and an off-topic
  -- conversation could never be flagged. Set once, by Phase C's
  -- ingestion endpoint (the room page passes the day's topic_title +
  -- the full cue-card pool it already had loaded, since there's no
  -- server-side "which card was showing" state — see the big comment on
  -- speaking_club_topic_of_day above); Phase D reads it, never modifies
  -- it. topic_title is null when the admin never set anything beyond
  -- the 'Free talk' default (topic-agnostic call, on-topic checking
  -- doesn't apply); cue_card_questions is a plain JSON array of strings,
  -- empty/null when that day had no cue cards configured.
  topic_title text,
  cue_card_questions jsonb,

  feedback_summary text, -- filled in once status = 'done'
  mistake_count int not null default 0,

  -- Phase D gap-fix (added here, same reasoning as the transcript column
  -- above): §5 step 6 of the plan requires "a few retries before giving
  -- up and surfacing an admin-visible failure count" on a failed row, but
  -- nothing in §4's original listing tracked how many attempts a row has
  -- already had — without this, the worker can't tell "retry again" from
  -- "give up, this is now terminally failed." Incremented once per
  -- worker attempt; status only becomes the terminal 'failed' once this
  -- reaches the worker's MAX_ATTEMPTS constant (see
  -- lib/speaking-feedback-worker.ts) — before that, a failed Gemini call
  -- just resets status back to 'pending' for the next run to retry.
  attempt_count int not null default 0,

  -- Phase D's background worker moves a row through this lifecycle:
  -- pending (just submitted) -> processing (Gemini call in flight) ->
  -- done (feedback_summary + mistake_logs rows written) or failed
  -- (retried on the next worker run per plan §5 step 6).
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),

  created_at timestamptz not null default now(),
  processed_at timestamptz -- set when status first becomes 'done' or 'failed'
);

-- Migration for already-deployed databases: `create table if not exists`
-- above is a no-op once the table already exists, so the two topic
-- columns need their own explicit add — same pattern as
-- mock_test_attempts.mistake_log_processed_at elsewhere in this file.
alter table if exists speaking_feedback add column if not exists topic_title text;
alter table if exists speaking_feedback add column if not exists cue_card_questions jsonb;

create index if not exists idx_speaking_feedback_shift_id on speaking_feedback (shift_id);
create index if not exists idx_speaking_feedback_student_username on speaking_feedback (student_username);
-- Phase D's worker polls for pending rows; Phase E.2's dashboard queries
-- a student's own rows ordered newest-first — this index serves both.
create index if not exists idx_speaking_feedback_student_created
  on speaking_feedback (student_username, created_at desc);
create index if not exists idx_speaking_feedback_status on speaking_feedback (status) where status in ('pending', 'processing');

create table if not exists mistake_logs (
  id uuid primary key default gen_random_uuid(),
  student_username text not null,

  -- Which feature produced this mistake. A check constraint (not just
  -- convention) so a mentor filtering by source = 'speaking_club' can
  -- never see a mock_test or quiz row mixed in. 'quiz' is reserved here
  -- per plan §4/§7.2 even though quiz mistakes turn out not to need a
  -- physical row in this table (quiz's mistakes are derived live from
  -- quiz_attempts vs quiz_questions — see plan §7.2) — kept in the
  -- allowed list in case that design ever changes.
  source text not null check (source in ('speaking_club', 'mock_test', 'quiz')),

  -- Points back to the row that produced this mistake: speaking_feedback.id
  -- for source = 'speaking_club', a mock_test_attempts.id for source =
  -- 'mock_test' once §7.1's future migration lands. Deliberately a plain
  -- text/uuid-as-text column, not a foreign key — it points at different
  -- tables depending on `source`, the same "DB-agnostic link" reasoning
  -- used for student_username/username1/2 elsewhere in this schema.
  source_ref_id text,

  category text not null
    check (category in ('grammar', 'vocabulary', 'pronunciation', 'fluency', 'coherence')),

  -- The specific mistake, in general terms — deliberately NOT a verbatim
  -- transcript quote (plan §4), since this is meant to be a reusable
  -- teaching note for mentors, not a record of exactly what was said.
  description text not null,

  created_at timestamptz not null default now()
);

create index if not exists idx_mistake_logs_student_username on mistake_logs (student_username);
-- The core mentor query from plan §5 step 8: "what's the most common
-- Speaking Club mistake this week" — filtered by source, browsed by
-- category, newest first. This index serves the source+category filter;
-- created_at ordering is covered by the btree's trailing column below.
create index if not exists idx_mistake_logs_source_category on mistake_logs (source, category, created_at desc);
create index if not exists idx_mistake_logs_source_ref_id on mistake_logs (source_ref_id);

-- SECURITY: same default-deny posture as speaking_shifts/mock_test_attempts
-- above — every read/write goes through the server (service role) from
-- the Phase C ingestion endpoint and Phase D worker, never queried
-- directly with the anon key from the browser. Enabling RLS with zero
-- policies means the public anon key gets a hard default-deny, as
-- defense-in-depth in case it's ever queried directly by mistake.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename in ('speaking_feedback', 'mistake_logs')
  loop
    execute format('drop policy if exists %I on %I', pol.policyname, pol.tablename);
  end loop;
end $$;

alter table speaking_feedback enable row level security;
alter table mistake_logs enable row level security;

-- =============================================================================
-- MOCK TEST → MISTAKE LOGS — Plan §7.1 Migration (was "future scope",
-- now being built). Additive only: the teacher's manual score/feedback
-- on mock_test_attempts (via /admin/scoring) is completely untouched —
-- this is a second, separate output from the same transcript, for
-- mentors' pattern-spotting, not a replacement for that scoring flow.
-- =============================================================================

-- The "has this attempt already been turned into mistake_logs rows"
-- tracker — same role speaking_feedback.status plays for Speaking Club,
-- deliberately kept as a single nullable timestamp rather than a status
-- enum: mock_test_attempts has no other lifecycle states to track
-- (unlike speaking_feedback, which also needs pending/processing to
-- coordinate the Phase C->D handoff — a mock test attempt is already
-- known-complete by the time completed_at is set, there's no separate
-- "submitted but not yet ready to process" phase to represent here).
alter table if exists mock_test_attempts add column if not exists mistake_log_processed_at timestamptz;

-- Gap-fix, same reasoning as speaking_feedback.attempt_count earlier in
-- this file: §7.1 step 2 says reuse Phase D's worker "as-is", but the
-- worker's whole retry/give-up design depends on knowing how many times
-- something has already been tried — mistake_log_processed_at alone
-- (null vs set) can't distinguish "never tried" from "tried and failed
-- repeatedly," which would mean a permanently-broken transcript gets
-- retried forever, burning one Gemini request every single worker run
-- indefinitely. Same MAX_ATTEMPTS constant and give-up-without-a-status-
-- enum approach as speaking_feedback: once this reaches MAX_ATTEMPTS,
-- the worker's query below simply stops selecting the row (still
-- unprocessed, but no longer retried) rather than needing a 'failed'
-- value with nowhere obvious to put it on this table.
alter table if exists mock_test_attempts add column if not exists mistake_log_attempt_count int not null default 0;

-- The worker's actual query, every run: "completed, has a transcript,
-- not yet processed, hasn't exhausted its retries." Indexed so that scan
-- stays cheap as mock_test_attempts grows — this table is not tiny like
-- speaking_feedback, it's every mock test ever taken.
create index if not exists idx_mock_test_attempts_mistake_log_pending
  on mock_test_attempts (completed_at)
  where mistake_log_processed_at is null;

-- =============================================================================
-- MOCK TEST SLOT BOOKING (Free-tier concurrency control)
-- The Live API's Free tier only allows a handful of concurrent sessions
-- (see the app's own README/handover notes — verify the exact number at
-- https://aistudio.google.com/rate-limit for this project, since AI Studio's
-- dashboard doesn't publish it in a fixed table). With ~300 students on one
-- project, letting everyone hit "Start Test" the moment their week unlocks
-- would blow straight through that limit and most would just get 429s.
--
-- Design: every eligible student is assigned a 25-minute slot (see
-- mock_test_slot_settings) inside a daily operating window (default 8am-
-- midnight, Asia/Dhaka), capacity_per_slot students per slot. They see their
-- slot time on the mock-test page and the "Start Test" button only actually
-- works once their slot has begun (see lib/mock-test-slots.ts,
-- checkSlotWindow — enforced server-side in gemini-session, not just hidden
-- client-side). isAtLiveCapacity() in the same file is a second, independent
-- safety net that checks actual concurrently-live mock_test_attempts rows
-- before ever spending a Gemini token, so even a gap in the scheduling
-- logic above can't overrun the real API quota.
-- =============================================================================

create table if not exists mock_test_slot_settings (
  id                     int primary key default 1,
  capacity_per_slot      int not null default 3,
  slot_minutes           int not null default 25,
  -- Local hour (0-23, in `timezone` below) the daily booking window opens.
  window_start_hour      int not null default 8,
  -- How many hours the window stays open each day, starting from
  -- window_start_hour — kept as a duration (not an end-hour) so "opens 8am,
  -- runs 16 hours" never has to represent midnight as the ambiguous "24:00"
  -- or "0:00 the next day" in a plain hour column.
  window_duration_hours  int not null default 16,
  -- Roughly how many students are expected to need a slot each week —
  -- combined with capacity_per_slot/slot_minutes/window_duration_hours,
  -- this determines how many trailing days of each Saturday-Friday week
  -- actually need to be opened up for testing (see
  -- compute_testing_days_needed() below): e.g. 300 students, ~114/day
  -- capacity -> the last 3 days of the week are testing days, the first 4
  -- are booking-only (students can still pick one of those upcoming slots
  -- early, they just can't test on Sat/Sun/Mon/Tue themselves).
  expected_student_count int not null default 300,
  -- First calendar day (in `timezone`) slots are offered from at all — null
  -- means "no extra gate, open as soon as a student is otherwise eligible".
  -- Lets admin hold the whole slot picker closed until a chosen rollout
  -- date (e.g. to line up with an ad-campaign launch) even if some
  -- students' weekly eligibility already unlocked earlier.
  booking_opens_on       date,
  timezone               text not null default 'Asia/Dhaka',
  updated_at             timestamptz not null default now()
);
insert into mock_test_slot_settings (id) values (1) on conflict (id) do nothing;
alter table mock_test_slot_settings add column if not exists booking_opens_on date;
alter table mock_test_slot_settings add column if not exists expected_student_count int not null default 300;

-- Shared by getSlotOptions (lib/mock-test-slots.ts) and
-- book_specific_mock_test_slot below so both sides of the picker (the list
-- the student sees, and the actual booking check) always agree on which
-- days count as "testing days" for a given week. Given a week runs
-- Saturday-Friday, this returns how many of the trailing days (Wed-Fri,
-- Thu-Fri, etc) are opened up for actual testing, based on how many
-- students are expected to need a slot versus daily capacity. Always
-- between 1 and 7 — even an absurdly small expected count still gets at
-- least the last day of the week, and an absurdly large one just claims
-- the whole week.
create or replace function compute_testing_days_needed(
  p_expected_student_count int,
  p_capacity_per_slot int,
  p_slot_minutes int,
  p_window_duration_hours int
) returns int as $$
declare
  v_slots_per_day int;
  v_daily_capacity int;
begin
  v_slots_per_day := floor((p_window_duration_hours * 60)::numeric / p_slot_minutes);
  if v_slots_per_day < 1 then
    v_slots_per_day := 1;
  end if;
  v_daily_capacity := p_capacity_per_slot * v_slots_per_day;
  if v_daily_capacity < 1 then
    v_daily_capacity := 1;
  end if;
  return greatest(1, least(7, ceil(p_expected_student_count::numeric / v_daily_capacity)::int));
end;
$$ language plpgsql immutable;

create table if not exists mock_test_slot_bookings (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  slot_start    timestamptz not null,
  slot_end      timestamptz not null,
  -- booked -> in_progress -> completed is the normal path. no_show is a
  -- 'booked' slot whose window passed with the student never starting
  -- (freed up automatically the next time book_mock_test_slot runs — see
  -- below — so it never permanently ties up a seat). cancelled is unused by
  -- the app today but kept as a spare terminal state.
  status        text not null default 'booked'
                  check (status in ('booked', 'in_progress', 'completed', 'no_show', 'cancelled')),
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

-- Capacity-check query (book_mock_test_slot below) filters by exact
-- slot_start + status — this is the index that query actually uses.
create index if not exists idx_slot_bookings_slot_start_status
  on mock_test_slot_bookings (slot_start, status);

-- "Does this student already have an active booking" lookups.
create index if not exists idx_slot_bookings_student
  on mock_test_slot_bookings (student_id, status, slot_start);

-- Atomically finds-or-creates a student's slot booking. Everything here
-- runs under one advisory lock (released automatically at the end of the
-- calling transaction — Supabase's PostgREST wraps each RPC call in its
-- own transaction) so concurrent requests from many students at once can
-- never both slip past the same slot's capacity check — booking is rare
-- enough (once per student per week) that serializing it entirely is cheap.
create or replace function book_mock_test_slot(p_student_id uuid)
returns table(slot_start timestamptz, slot_end timestamptz, status text) as $$
#variable_conflict use_column
declare
  v_settings   mock_test_slot_settings%rowtype;
  v_now        timestamptz := now();
  v_existing   mock_test_slot_bookings%rowtype;
  v_interval   interval;
  v_local_date date;
  v_win_start  timestamptz;
  v_win_end    timestamptz;
  v_candidate  timestamptz;
  v_count      int;
  v_min_remaining constant interval := interval '15 minutes';
begin
  perform pg_advisory_xact_lock(hashtext('mock_test_slot_booking')::bigint);

  select * into v_settings from mock_test_slot_settings where id = 1;
  if not found then
    v_settings.capacity_per_slot := 3;
    v_settings.slot_minutes := 25;
    v_settings.window_start_hour := 8;
    v_settings.window_duration_hours := 16;
    v_settings.timezone := 'Asia/Dhaka';
  end if;
  v_interval := (v_settings.slot_minutes::text || ' minutes')::interval;

  -- Free a 'booked' slot the student never showed up for, and a very-stale
  -- 'in_progress' one (crashed browser, never hit /complete) — mirrors the
  -- ORPHAN_GRACE_MS idea already used for mock_test_attempts in
  -- lib/mock-test.ts, so a dead session can never permanently block this
  -- student from ever booking again.
  update mock_test_slot_bookings
    set status = 'no_show'
    where student_id = p_student_id and status = 'booked' and slot_end < v_now;
  update mock_test_slot_bookings
    set status = 'completed'
    where student_id = p_student_id and status = 'in_progress' and slot_end < v_now - interval '2 hours';

  -- Already has a live booking (upcoming, or actually in progress) — hand
  -- that back instead of creating a duplicate one.
  select * into v_existing
    from mock_test_slot_bookings
    where student_id = p_student_id and status in ('booked', 'in_progress')
    order by slot_start asc
    limit 1;

  if found then
    return query select v_existing.slot_start, v_existing.slot_end, v_existing.status;
    return;
  end if;

  -- Start from whichever slot boundary "now" currently falls inside (not
  -- just the next upcoming one) — a partially-elapsed slot with real
  -- capacity left shouldn't sit unused while students queue for a fresh
  -- one. But skip it if there's not enough of it left for a fair-length
  -- test (v_min_remaining) — then it's the same as any full future slot.
  v_local_date := (v_now at time zone v_settings.timezone)::date;
  v_win_start := (v_local_date::text || ' ' || v_settings.window_start_hour::text || ':00')::timestamp
                   at time zone v_settings.timezone;

  if v_now < v_win_start then
    v_candidate := v_win_start;
  else
    v_candidate := v_win_start
      + floor(extract(epoch from (v_now - v_win_start)) / extract(epoch from v_interval)) * v_interval;
    if v_candidate + v_interval - v_now < v_min_remaining then
      v_candidate := v_candidate + v_interval;
    end if;
  end if;

  loop
    -- Recompute the window for whichever local day v_candidate has rolled
    -- into (it may have crossed midnight since the last iteration).
    v_local_date := (v_candidate at time zone v_settings.timezone)::date;
    v_win_start := (v_local_date::text || ' ' || v_settings.window_start_hour::text || ':00')::timestamp
                     at time zone v_settings.timezone;
    v_win_end := v_win_start + (v_settings.window_duration_hours::text || ' hours')::interval;

    if v_candidate < v_win_start then
      v_candidate := v_win_start;
    end if;

    if v_candidate + v_interval > v_win_end then
      -- No full slot left today — jump to tomorrow's window open.
      v_candidate := v_win_start + interval '1 day';
      continue;
    end if;

    select count(*) into v_count
      from mock_test_slot_bookings
      where slot_start = v_candidate and status in ('booked', 'in_progress');

    if v_count < v_settings.capacity_per_slot then
      insert into mock_test_slot_bookings (student_id, slot_start, slot_end, status)
      values (p_student_id, v_candidate, v_candidate + v_interval, 'booked');
      return query select v_candidate, v_candidate + v_interval, 'booked'::text;
      return;
    end if;

    v_candidate := v_candidate + v_interval;
  end loop;
end;
$$ language plpgsql;

-- Lets a student pick their own slot (instead of book_mock_test_slot's
-- auto-assign) — validates the chosen time actually lands on a real slot
-- boundary inside that day's window (never trusts the client's timestamp
-- blindly), handles rescheduling (cancels their old not-yet-started
-- booking if they pick a different time), and does the same race-safe
-- capacity check under the SAME advisory lock name as book_mock_test_slot
-- so the two paths can never both slip past a slot's capacity at once.
-- Returns a row with error set (and the other columns null) instead of
-- raising, so the API route can turn it into a normal JSON error response.
create or replace function book_specific_mock_test_slot(p_student_id uuid, p_slot_start timestamptz)
returns table(slot_start timestamptz, slot_end timestamptz, status text, error text) as $$
#variable_conflict use_column
declare
  v_settings        mock_test_slot_settings%rowtype;
  v_now             timestamptz := now();
  v_existing        mock_test_slot_bookings%rowtype;
  v_interval        interval;
  v_local_date      date;
  v_win_start       timestamptz;
  v_win_end         timestamptz;
  v_open_start      timestamptz;
  v_count           int;
  v_min_remaining   constant interval := interval '15 minutes';
  v_valid           boolean;
  v_testing_days    int;
  v_sat_index       int; -- 0=Saturday .. 6=Friday, for the week-position check
  v_week_start      date; -- this Saturday, for the "already missed this week" check below
begin
  perform pg_advisory_xact_lock(hashtext('mock_test_slot_booking')::bigint);

  select * into v_settings from mock_test_slot_settings where id = 1;
  if not found then
    v_settings.capacity_per_slot := 3;
    v_settings.slot_minutes := 25;
    v_settings.window_start_hour := 8;
    v_settings.window_duration_hours := 16;
    v_settings.expected_student_count := 300;
    v_settings.timezone := 'Asia/Dhaka';
  end if;
  v_interval := (v_settings.slot_minutes::text || ' minutes')::interval;

  if v_settings.booking_opens_on is not null then
    v_open_start := (v_settings.booking_opens_on::text || ' ' || v_settings.window_start_hour::text || ':00')::timestamp
                      at time zone v_settings.timezone;
    if p_slot_start < v_open_start then
      return query select null::timestamptz, null::timestamptz, null::text, 'Slot booking hasn''t opened yet.'::text;
      return;
    end if;
  end if;

  -- Only the trailing N days of each Saturday-Friday week are open for
  -- actual testing (see compute_testing_days_needed) — e.g. N=3 means
  -- Wed/Thu/Fri only. extract(dow ...) is 0=Sunday..6=Saturday; +1 mod 7
  -- reindexes it to 0=Saturday..6=Friday so "trailing N days" is just
  -- "index >= 7 - N".
  v_testing_days := compute_testing_days_needed(
    v_settings.expected_student_count, v_settings.capacity_per_slot, v_settings.slot_minutes, v_settings.window_duration_hours
  );
  v_sat_index := mod(extract(dow from (p_slot_start at time zone v_settings.timezone))::int + 1, 7);
  if v_sat_index < 7 - v_testing_days then
    return query select null::timestamptz, null::timestamptz, null::text, 'That day isn''t open for testing this week — please pick one of the later days.'::text;
    return;
  end if;

  v_local_date := (p_slot_start at time zone v_settings.timezone)::date;
  v_win_start := (v_local_date::text || ' ' || v_settings.window_start_hour::text || ':00')::timestamp
                   at time zone v_settings.timezone;
  v_win_end := v_win_start + (v_settings.window_duration_hours::text || ' hours')::interval;

  v_valid := p_slot_start >= v_win_start
    and p_slot_start + v_interval <= v_win_end
    and mod(
          round(extract(epoch from (p_slot_start - v_win_start)))::numeric,
          round(extract(epoch from v_interval))::numeric
        ) = 0;

  if not v_valid then
    return query select null::timestamptz, null::timestamptz, null::text, 'That time isn''t a valid slot.'::text;
    return;
  end if;

  if p_slot_start + v_interval <= v_now then
    return query select null::timestamptz, null::timestamptz, null::text, 'That slot has already passed.'::text;
    return;
  end if;

  if p_slot_start <= v_now and p_slot_start + v_interval - v_now < v_min_remaining then
    return query select null::timestamptz, null::timestamptz, null::text, 'That slot is about to end — please pick a later one.'::text;
    return;
  end if;

  -- Same stale-booking cleanup as book_mock_test_slot, so a picker session
  -- never gets blocked by the student's own dead history either.
  update mock_test_slot_bookings
    set status = 'no_show'
    where student_id = p_student_id and status = 'booked' and slot_end < v_now;
  update mock_test_slot_bookings
    set status = 'completed'
    where student_id = p_student_id and status = 'in_progress' and slot_end < v_now - interval '2 hours';

  -- One mock per student per week: a slot that was booked and then missed
  -- (no_show) uses up that week's turn entirely — no re-picking a later
  -- day in the SAME week. v_week_start is the Saturday that starts the
  -- week p_slot_start falls in (mirrors the Sat-Fri week used by the
  -- testing-day check above), so this only blocks that one week, not the
  -- student generally. A 'cancelled' reschedule (picking a different time
  -- before the old one passed) is untouched by this — only a genuine miss
  -- counts.
  v_week_start := v_local_date - v_sat_index;
  if exists (
    select 1 from mock_test_slot_bookings
    where student_id = p_student_id
      and status = 'no_show'
      and (slot_start at time zone v_settings.timezone)::date >= v_week_start
      and (slot_start at time zone v_settings.timezone)::date < v_week_start + 7
  ) then
    return query select null::timestamptz, null::timestamptz, null::text,
      'You missed your slot this week — a new one opens up next week.'::text;
    return;
  end if;

  select * into v_existing
    from mock_test_slot_bookings
    where student_id = p_student_id and status in ('booked', 'in_progress')
    order by slot_start asc
    limit 1;

  if found then
    -- Already testing — can't move a session that's already started.
    if v_existing.status = 'in_progress' then
      return query select v_existing.slot_start, v_existing.slot_end, v_existing.status, null::text;
      return;
    end if;
    -- Re-tapping the slot they already hold — just confirm it, no-op.
    if v_existing.slot_start = p_slot_start then
      return query select v_existing.slot_start, v_existing.slot_end, v_existing.status, null::text;
      return;
    end if;
    -- Picking a different time — this is a reschedule: free the old one
    -- first so it doesn't keep occupying a seat nobody else can use.
    update mock_test_slot_bookings set status = 'cancelled' where id = v_existing.id;
  end if;

  select count(*) into v_count
    from mock_test_slot_bookings
    where slot_start = p_slot_start and status in ('booked', 'in_progress');

  if v_count >= v_settings.capacity_per_slot then
    return query select null::timestamptz, null::timestamptz, null::text, 'That slot just filled up — please pick another.'::text;
    return;
  end if;

  insert into mock_test_slot_bookings (student_id, slot_start, slot_end, status)
  values (p_student_id, p_slot_start, p_slot_start + v_interval, 'booked');

  return query select p_slot_start, p_slot_start + v_interval, 'booked'::text, null::text;
end;
$$ language plpgsql;

-- SECURITY: same default-deny posture as students/mock_test_attempts above
-- — every read/write goes through the server (supabaseServer, service
-- role) from lib/mock-test-slots.ts and the /api/mock-test/slot,
-- /api/mock-test/gemini-session, and /api/admin/mock-test-slot-settings
-- routes, never queried directly with the anon key from the browser.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'mock_test_slot_bookings'
  loop
    execute format('drop policy if exists %I on mock_test_slot_bookings', pol.policyname);
  end loop;

  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'mock_test_slot_settings'
  loop
    execute format('drop policy if exists %I on mock_test_slot_settings', pol.policyname);
  end loop;
end $$;

alter table mock_test_slot_bookings enable row level security;
alter table mock_test_slot_settings enable row level security;

-- =============================================================================
-- SPEAKING CLUB — daily topic + rotating cue cards
-- Gives the two students in a call something to talk about instead of an
-- unstructured hour: admin sets one topic + a set of IELTS-style cue-card
-- questions each day; the call room auto-advances through them every
-- rotation_minutes, and either participant can tap "Shuffle" to jump to a
-- different one early. Both participants' auto-advance timing and any
-- shuffle are kept in sync client-side over a Realtime broadcast channel
-- (see lib/speaking-club/cue-card-channel.ts) — nothing about *which* card
-- is showing is persisted server-side, only the day's topic + card pool are.
-- =============================================================================

create table if not exists speaking_club_topic_of_day (
  id                int primary key default 1,
  topic_title       text not null default 'Free talk',
  rotation_minutes  int not null default 8,
  updated_at        timestamptz not null default now()
);
insert into speaking_club_topic_of_day (id) values (1) on conflict (id) do nothing;

-- Admin replaces the whole set each time they save a new day's cards
-- (delete + re-insert — see /api/admin/speaking-club/cue-cards), so there's
-- no is_active/date column: this table only ever holds "today's" cards.
create table if not exists speaking_club_cue_cards (
  id             uuid primary key default gen_random_uuid(),
  question_text  text not null,
  order_index    int not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_speaking_cue_cards_order on speaking_club_cue_cards (order_index);

-- SECURITY: same default-deny posture as every other table in this file —
-- read/write only via the server (supabaseServer, service role) from
-- lib/speaking-club-cue-cards.ts and its API routes.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'speaking_club_topic_of_day'
  loop
    execute format('drop policy if exists %I on speaking_club_topic_of_day', pol.policyname);
  end loop;

  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'speaking_club_cue_cards'
  loop
    execute format('drop policy if exists %I on speaking_club_cue_cards', pol.policyname);
  end loop;
end $$;

alter table speaking_club_topic_of_day enable row level security;
alter table speaking_club_cue_cards enable row level security;

-- =============================================================================
-- SPEAKING CLUB — "New words I learned" notes (shared with the partner)
-- Students jot down a word/phrase they picked up while the call is running
-- (components/speaking-club/learned-words-notes.tsx). Both people in the
-- room see everything noted in that session, live, and each keeps a copy
-- afterwards on the /speaking-club dashboard.
--
-- Design notes:
--  * Shifts are DAILY-RECURRING rows (the same speaking_shifts.id every
--    day), so a "session" is (shift, day) — `session_date` (Asia/Dhaka) is
--    what scopes the per-session duplicate check and the per-session cap.
--  * `shared_with` is a snapshot of who else was in the room when the word
--    was written. Visibility = author OR listed in shared_with, so it stays
--    correct after the admin reassigns partners, and never leaks a word to
--    whoever gets that shift next.
--  * room_code / shift_number / session_date are denormalized snapshots, so
--    a word's history label survives the shift row being deleted (then
--    shift_id becomes NULL via ON DELETE SET NULL, and nothing else cares).
--  * `username` is Turso users.email — same "DB-agnostic link" as
--    speaking_shifts.username1/2.
--  * `word_key` = lower-cased, whitespace-collapsed word, for the duplicate
--    check.
-- =============================================================================
create table if not exists speaking_learned_words (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  shift_id      uuid references speaking_shifts(id) on delete set null,
  room_code     text,
  shift_number  smallint,
  session_date  date not null default ((now() at time zone 'Asia/Dhaka')::date),
  shared_with   text[] not null default '{}',
  word          text not null check (char_length(word) between 1 and 120),
  word_key      text not null,
  meaning       text check (meaning is null or char_length(meaning) <= 300),
  created_at    timestamptz not null default now()
);

-- ---- Upgrade path (safe to run repeatedly) --------------------------------
-- If you already ran the FIRST version of this table (personal-only, no
-- room_code/session_date/shared_with, 80/200 length limits), this block
-- brings it up to date without losing rows. On a fresh install every
-- statement below is a harmless no-op.
alter table speaking_learned_words add column if not exists room_code text;
alter table speaking_learned_words add column if not exists shift_number smallint;
alter table speaking_learned_words add column if not exists session_date date;
alter table speaking_learned_words add column if not exists shared_with text[] not null default '{}';

update speaking_learned_words
  set session_date = (created_at at time zone 'Asia/Dhaka')::date
  where session_date is null;

update speaking_learned_words w
  set room_code = l.room_code, shift_number = l.shift_number
  from speaking_shift_lookup l
  where w.shift_id = l.shift_id and w.room_code is null;

alter table speaking_learned_words
  alter column session_date set default ((now() at time zone 'Asia/Dhaka')::date);
alter table speaking_learned_words alter column session_date set not null;

alter table speaking_learned_words drop constraint if exists speaking_learned_words_word_check;
alter table speaking_learned_words
  add constraint speaking_learned_words_word_check check (char_length(word) between 1 and 120);
alter table speaking_learned_words drop constraint if exists speaking_learned_words_meaning_check;
alter table speaking_learned_words
  add constraint speaking_learned_words_meaning_check check (meaning is null or char_length(meaning) <= 300);

-- v1 keyed uniqueness on (username, shift_id, word_key) with no date — but
-- the shift row recurs daily, so that would have blocked re-saving a word
-- on a later day. Replaced by a per-session (per-day) key. Deliberately NOT
-- "NULLS NOT DISTINCT": deleting a shift sets shift_id to NULL on its words,
-- and null-not-distinct would make that delete fail when a student saved the
-- same word in two shifts. Shift-less rows (dev ?as= path only) are
-- de-duplicated by the app-level check in lib/speaking-club-words.ts.
drop index if exists idx_speaking_learned_words_unique;
create unique index if not exists idx_speaking_learned_words_session_unique
  on speaking_learned_words (username, session_date, shift_id, word_key);

create index if not exists idx_speaking_learned_words_user_created
  on speaking_learned_words (username, created_at desc);
create index if not exists idx_speaking_learned_words_shift_session
  on speaking_learned_words (shift_id, session_date);
create index if not exists idx_speaking_learned_words_shared_with
  on speaking_learned_words using gin (shared_with);

-- SECURITY: same default-deny posture as every other table in this file —
-- read/write only via the server (supabaseServer, service role) from
-- lib/speaking-club-words.ts and /api/speaking-club/words.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'speaking_learned_words'
  loop
    execute format('drop policy if exists %I on speaking_learned_words', pol.policyname);
  end loop;
end $$;

alter table speaking_learned_words enable row level security;

-- =============================================================================
-- SPEAKING CLUB — end-of-session quick rating
-- After a call, each student gets a two-tap prompt: "How was your session?"
-- (1-5) and "Practice with this partner again?" (yes / maybe / no). One row
-- per student per session — a session is (shift, day), because shift rows
-- recur daily — and a re-submit for the same session updates that row.
--
-- Read only by admins (Monitoring tab) and, later, by auto-pairing to avoid
-- re-matching people who said "no". Students never read these back.
--
-- partner_usernames is a snapshot of who else was on the shift when the
-- rating was given, so the data stays meaningful after partners are
-- reassigned; room_code / shift_number / session_date are denormalized
-- snapshots for the same reason (shift_id goes NULL if the shift row is
-- deleted, ON DELETE SET NULL, and nothing else depends on it).
-- `username` is Turso users.email (same DB-agnostic link as the rest).
-- =============================================================================
create table if not exists speaking_session_ratings (
  id                 uuid primary key default gen_random_uuid(),
  username           text not null,
  shift_id           uuid references speaking_shifts(id) on delete set null,
  room_code          text,
  shift_number       smallint,
  session_date       date not null default ((now() at time zone 'Asia/Dhaka')::date),
  partner_usernames  text[] not null default '{}',
  rating             smallint not null check (rating between 1 and 5),
  would_pair_again   text check (would_pair_again in ('yes', 'maybe', 'no')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists idx_speaking_session_ratings_once
  on speaking_session_ratings (username, session_date, shift_id);
create index if not exists idx_speaking_session_ratings_created
  on speaking_session_ratings (created_at desc);

-- SECURITY: default-deny like every other table here — server (service
-- role) only, via lib/speaking-club-ratings.ts.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'speaking_session_ratings'
  loop
    execute format('drop policy if exists %I on speaking_session_ratings', pol.policyname);
  end loop;
end $$;

alter table speaking_session_ratings enable row level security;

-- =============================================================================
-- SPEAKING CLUB — attendance (feeds the Activity streak + Speaking Club stats)
-- One row per student per SESSION (a shift on a given Asia/Dhaka day —
-- shift rows recur daily). Written server-side by /api/speaking-club/
-- turn-stats when a call ends (lib/speaking-club-attendance.ts).
--
-- Why a table of its own instead of reading speaking_turn_usage directly:
-- that table is an append-only relay-monitoring log — one row per call
-- report, including calls where the student left after a few seconds or
-- was alone in the room. "Attended" needs a real definition, so:
--   qualified = call_seconds >= 300 (5 min, summed across rejoins that
--               session) AND a partner was really there (partner_confirmed:
--               the client saw a peer connection AND the partner's presence
--               heartbeat on this shift is from today).
-- Only qualified rows count towards streaks/stats. Non-qualified rows are
-- kept so a second short rejoin can still add up to a qualifying session.
--
-- room_code / shift_number / session_date are denormalized snapshots so
-- history survives the shift row being deleted (shift_id then goes NULL,
-- ON DELETE SET NULL). `username` is Turso users.email.
-- =============================================================================
create table if not exists speaking_attendance (
  id                 uuid primary key default gen_random_uuid(),
  username           text not null,
  shift_id           uuid references speaking_shifts(id) on delete set null,
  room_code          text,
  shift_number       smallint,
  session_date       date not null,
  call_seconds       integer not null default 0,
  peer_count         smallint not null default 2,
  partner_confirmed  boolean not null default false,
  qualified          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists idx_speaking_attendance_session
  on speaking_attendance (username, session_date, shift_id);
create index if not exists idx_speaking_attendance_user_qualified
  on speaking_attendance (username, session_date desc) where qualified = true;

-- One-time, re-runnable backfill from calls already logged in
-- speaking_turn_usage, so students keep the streak days they had already
-- earned: only calls that would have qualified (5+ min, with a partner)
-- become attended sessions. Rows without a shift are skipped (the unique
-- key above can't dedupe NULL shifts; and such rows were dev-path only).
insert into speaking_attendance
  (username, shift_id, room_code, shift_number, session_date, call_seconds, peer_count, partner_confirmed, qualified, created_at, updated_at)
select
  username,
  shift_id,
  max(room_code),
  max(shift_number),
  (created_at at time zone 'Asia/Dhaka')::date,
  sum(call_duration_seconds)::integer,
  max(peer_count)::smallint,
  true,
  true,
  min(created_at),
  max(created_at)
from speaking_turn_usage
where call_duration_seconds >= 300 and peer_count >= 2 and shift_id is not null
group by username, shift_id, (created_at at time zone 'Asia/Dhaka')::date
on conflict (username, session_date, shift_id) do nothing;

-- SECURITY: default-deny like every other table here — server (service
-- role) only, via lib/speaking-club-attendance.ts.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'speaking_attendance'
  loop
    execute format('drop policy if exists %I on speaking_attendance', pol.policyname);
  end loop;
end $$;

alter table speaking_attendance enable row level security;
