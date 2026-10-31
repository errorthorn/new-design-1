-- Admin access by ACCOUNT (not just by pasted key).
--
-- The owner can now give a normal LingoCraft user admin access from /admin/staff
-- by typing that person's account email and ticking the sections. When that user
-- signs in, an "Admin" option appears in their profile menu and /admin shows only
-- the sections they were given. No key needs to be pasted.
--
-- Run this once in the Supabase SQL editor. Safe to run more than once.
-- (Staff who were created with an access key before keep working unchanged.)

alter table admin_staff add column if not exists user_id text;   -- users.id of the linked account
alter table admin_staff add column if not exists email text;     -- shown in the staff list only

-- An account-linked staff member has no key at all.
alter table admin_staff alter column key_hash drop not null;
alter table admin_staff alter column key_hint drop not null;

-- One staff row per account.
create unique index if not exists admin_staff_user_id_key
  on admin_staff (user_id) where user_id is not null;
