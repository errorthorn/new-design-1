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
