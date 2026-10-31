-- Staff admin accounts: each staff member gets a personal access key and a list of the
-- admin sections they may use (scoring, questions, speaking-club, mock-test, quiz).
-- Only a hash of the key is stored. Safe to run more than once.
create table if not exists admin_staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  key_hint text not null,
  sections text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- Server-only table (the app reads it with the service role); block all direct access.
alter table admin_staff enable row level security;
