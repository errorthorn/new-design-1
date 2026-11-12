-- Structured AI feedback report for the student-facing "View AI Feedback" screen
-- (bands, per-criterion fixes, better version, practice plan, pronunciation tips).
-- Older rows keep working: they have no report_json, so the screen falls back to the plain text.
-- Safe to run more than once. Run it once in the Supabase SQL editor.
alter table if exists speaking_feedback add column if not exists report_json jsonb;
