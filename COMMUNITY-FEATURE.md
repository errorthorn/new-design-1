# Community — Doubts & Q&A

Built to replace the "Coming soon" stub at `/dashboard/community`. This is a
doubt-clearing question & answer board — not a full clone of the reference
screenshot's SAT-domain-tagged system, just: post a question, anyone replies,
upvote what's helpful, and the original poster can mark one reply as the
accepted answer.

## What's new

- **`sql/schema.sql`** — appended `community_questions`, `community_answers`,
  `community_votes` tables (RLS enabled, no public policies — same
  server-only access pattern as the rest of the schema). **Run this file's
  new section in the Supabase SQL editor** (safe to re-run the whole file).
- **`lib/community-db.ts`** — all the data-access functions (list/create
  questions, create answers, toggle votes, accept an answer).
- **`app/api/community/...`** — the API routes:
  - `GET/POST /api/community/questions` — list (search, status/topic filter,
    "my posts", sort) and create
  - `GET /api/community/questions/[id]` — question + its replies
  - `POST /api/community/questions/[id]/answers` — reply
  - `POST /api/community/questions/[id]/vote` — upvote/un-upvote a question
  - `POST /api/community/answers/[id]/vote` — upvote/un-upvote a reply
  - `POST /api/community/questions/[id]/accept` — poster marks a reply
    accepted (also flips the question to "solved")
- **`app/dashboard/community/`** — the pages: list (`page.tsx`), ask a
  question (`new/page.tsx`), question detail with replies (`[id]/page.tsx`).
- **`lib/utils.ts`** — added a small `timeAgo()` helper ("about 3 hours ago").

## Not done / left for later

- No edit/delete on questions or replies yet.
- No notifications when someone replies to your question.
- No admin moderation panel — nothing stops abuse right now beyond
  requiring a signed-in account.
- `topic` is a free-text field the poster can type, not a fixed dropdown —
  add a fixed list later if you want consistent filtering categories.

## To run locally

1. Paste the new part of `sql/schema.sql` into the Supabase SQL editor (or
   just re-run the whole file — every statement is `if not exists`/re-runnable).
2. `npm install`
3. `npm run dev`, then visit `/dashboard/community`.

Everything follows the same patterns already in the codebase
(`requireUser()` from `lib/api-auth.ts`, `supabaseServer`, the
cream/ink/leaf/night Tailwind palette) — nothing new introduced.
