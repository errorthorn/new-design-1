// lib/db.ts
//
// Database client via @libsql/client — this is SQLite-compatible, so the
// exact same code works two ways:
//
//  1. Locally / self-hosted: no env vars needed, it just writes to a local
//     file (data/app.db). Nothing to sign up for.
//
//  2. On Vercel (or any read-only-filesystem host): set TURSO_DATABASE_URL
//     and TURSO_AUTH_TOKEN (from https://turso.tech, free tier is plenty
//     for a small app) and it transparently talks to that instead. Turso is
//     just hosted SQLite (libSQL), so no query syntax changes.
//
// All queries in this file are async (unlike better-sqlite3, which this
// replaces) because @libsql/client is promise-based.

import { createClient, type Client } from "@libsql/client";
import path from "path";
import fs from "fs";

let client: Client;

if (process.env.TURSO_DATABASE_URL) {
  client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
} else {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  client = createClient({ url: `file:${path.join(dataDir, "app.db")}` });
}

// Adds a column to `users` if it isn't there yet. SQLite errors on
// `ADD COLUMN` for a column that already exists, so every migration here
// is wrapped and the error is swallowed — this makes init() safe to run
// against a database that already has these columns (fresh installs get
// them via the CREATE TABLE below; existing databases get them from here).
async function addColumnIfMissing(table: string, columnDef: string) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch {
    // Column already exists (or table doesn't exist yet) — nothing to do.
  }
}

let ready: Promise<unknown> | undefined;
function init() {
  if (!ready) {
    ready = client
      .execute(`
        CREATE TABLE IF NOT EXISTS users (
          id                       INTEGER PRIMARY KEY AUTOINCREMENT,
          email                    TEXT UNIQUE NOT NULL,
          password_hash            TEXT,
          name                     TEXT,
          google_id                TEXT UNIQUE,
          reset_token_hash         TEXT,
          reset_token_expires_at   TEXT,
          subscription_active      INTEGER NOT NULL DEFAULT 0,
          subscription_expires_at  TEXT,
          created_at               TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
      .then(() =>
        Promise.all([
          // Covers databases created before these columns existed.
          addColumnIfMissing("users", "subscription_active INTEGER NOT NULL DEFAULT 0"),
          addColumnIfMissing("users", "subscription_expires_at TEXT"),
          // Google sign-in's profile picture — kept in sync on every Google
          // login (see lib/next-auth-options.js). Null for email/password
          // accounts unless/until they link Google.
          addColumnIfMissing("users", "avatar_url TEXT"),
          // Weekly mock-test / practice reminder emails — on by default,
          // toggle lives on /profile. Only the preference is stored here;
          // the actual reminder-sending job is a separate piece of work
          // (a cron/scheduled function reading this column) and hasn't
          // been built yet.
          addColumnIfMissing("users", "email_reminders_enabled INTEGER NOT NULL DEFAULT 1"),
          // Which /profile achievement badges this account has already
          // been shown the celebration animation for — server-side (not
          // localStorage) so the "you just unlocked this" confetti fires
          // correctly regardless of which browser/device the person is on.
          // achievements_initialized distinguishes "never computed before"
          // (don't celebrate anything already-earned on first ever visit)
          // from "genuinely just unlocked since last time" (do celebrate).
          addColumnIfMissing("users", "seen_achievements TEXT NOT NULL DEFAULT '[]'"),
          addColumnIfMissing("users", "achievements_initialized INTEGER NOT NULL DEFAULT 0"),
          // How many weekly mock-test slots this membership includes, e.g.
          // a 1-month plan = 4 weeks, a 2-month plan = 8 weeks. Set by an
          // admin (see /admin/members and /admin/mock-test) alongside
          // subscription_expires_at — kept as an explicit column rather
          // than derived from the expiry date so an admin can always
          // override it by hand for an odd/custom plan. NULL means "not
          // set yet"; the dashboard falls back to a default in that case.
          addColumnIfMissing("users", "subscription_weeks INTEGER"),
          // Every account's own share code for the Refer & Earn feature
          // (see /dashboard/refer). Generated lazily the first time it's
          // needed (lib/referral.ts) rather than at signup, so this stays
          // NULL until then — uniqueness is enforced by the partial
          // unique index below rather than a column constraint, since
          // SQLite can't ALTER TABLE ADD a UNIQUE column.
          addColumnIfMissing("users", "referral_code TEXT"),
          // Which plan tier (see lib/plans.ts: 'starter' | 'pro' | 'dedicated')
          // this account's active membership is on — set automatically when
          // an admin approves a payment claim (/admin/payments) by copying
          // payment_claims.plan across, or by hand on /admin/members. This is
          // what powers the Pro/Starter badge on the members list; it isn't
          // cleared on expiry/revoke so the badge still reflects "last plan
          // held" even while inactive.
          addColumnIfMissing("users", "plan TEXT"),
        ])
      )
      .then(() =>
        // No real payment gateway yet — a submission here is a customer's
        // claim that they sent bKash/Nagad money, waiting on a human to
        // check it and flip `subscription_active` on (see /admin/members).
        client.execute(`
          CREATE TABLE IF NOT EXISTS payment_claims (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            email         TEXT NOT NULL,
            plan          TEXT NOT NULL DEFAULT 'pro',
            method        TEXT NOT NULL,
            sender_number TEXT NOT NULL,
            trx_id        TEXT NOT NULL,
            amount        INTEGER NOT NULL DEFAULT 399,
            status        TEXT NOT NULL DEFAULT 'pending',
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      )
      .then(() =>
        Promise.all([
          // Which Refer & Earn discount code (if any) the customer applied
          // when submitting this claim, and what percent it was worth at
          // the time — kept alongside the claim (rather than only on
          // discount_credits) so the admin approval screen shows it
          // without a join, and so it stays accurate even if the code
          // later expires/changes. NULL/0 for a claim with no discount.
          addColumnIfMissing("payment_claims", "discount_code TEXT"),
          addColumnIfMissing("payment_claims", "discount_percent INTEGER"),
          // Which plan (see lib/plans.ts) this claim was for — 'pro' by
          // default so existing rows from before Starter/Dedicated existed
          // read the same way they always billed (a flat Pro Plus plan).
          addColumnIfMissing("payment_claims", "plan TEXT NOT NULL DEFAULT 'pro'"),
        ])
      )
      .then(() =>
        // One row per successful referral: `referrer_id` shared their
        // code, `referred_id` redeemed it from /dashboard/refer. The
        // UNIQUE on referred_id is what makes redemption one-time per
        // account (a person can only ever have been referred by one
        // other person) — enforced here in addition to the app-level
        // check in app/api/referral/redeem/route.ts.
        client.execute(`
          CREATE TABLE IF NOT EXISTS referrals (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id   INTEGER NOT NULL,
            referred_id   INTEGER NOT NULL UNIQUE,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      )
      .then(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_id, created_at DESC);`
        )
      )
      .then(() =>
        // Snapshot, taken at the moment of redemption, of whether the
        // redeemer already had an active subscription (subscription_active
        // on `users`) — covers BOTH a genuinely approved payment_claims row
        // AND a subscription an admin granted by hand on /admin/members
        // (comps, testing, fixing a mistake), which never creates a
        // payment_claims row at all. Comparing payment_claims timestamps
        // after the fact (the old approach) silently missed that second
        // case, so the "already paid" refund flow never triggered for
        // manually-granted accounts. Recording it directly here at
        // redemption time is exact regardless of how the subscription was
        // activated. NULL for referrals redeemed before this column
        // existed — treated as "no" (unknown), same as before.
        addColumnIfMissing("referrals", "redeemer_already_subscribed INTEGER")
      )
      .then(() =>
        // Same idea as redeemer_already_subscribed above, but for the
        // *referrer* — the person who shared their code, not the friend
        // who redeemed it. The referrer is, by definition, already an
        // existing user, so they're frequently already an active
        // subscriber themselves when a friend redeems their code. Their
        // reward code has the exact same "nothing to apply this to"
        // problem as the redeemer's does in that case, so it needs the
        // same manual-refund flow — this column is what that's based on.
        // NULL for referrals redeemed before this column existed.
        addColumnIfMissing("referrals", "referrer_already_subscribed INTEGER")
      )
      .then(() =>
        // Only enforces uniqueness for rows that actually have a code set
        // — NULL referral_code (an account that hasn't opened Refer &
        // Earn yet) is never compared for uniqueness by SQLite anyway,
        // but the WHERE clause keeps that explicit and future-proof.
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users (referral_code) WHERE referral_code IS NOT NULL;`
        )
      )
      .then(() =>
        // A 25%-off code earned either by referring someone (reason =
        // 'referral_referrer') or by redeeming a friend's code (reason =
        // 'referral_redeemed') — see lib/referral.ts. Redeemed at
        // /payment by passing it to /api/payment/submit, which marks it
        // used and discounts that claim's amount. One-time use, tracked
        // here rather than assumed from payment_claims since a claim can
        // be rejected and the discount shouldn't be burned in that case
        // (see the rollback in app/api/admin/payments/route.ts).
        client.execute(`
          CREATE TABLE IF NOT EXISTS discount_credits (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            code        TEXT UNIQUE NOT NULL,
            percent     INTEGER NOT NULL DEFAULT 25,
            reason      TEXT NOT NULL,
            used        INTEGER NOT NULL DEFAULT 0,
            used_at     TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      )
      .then(() =>
        Promise.all([
          // Which `referrals` row (if any) this code came from — lets the
          // admin /admin/referrals screen join a referral event straight
          // to the two discount codes it produced, instead of guessing by
          // timestamp. NULL for older rows created before this existed.
          addColumnIfMissing("discount_credits", "referral_id INTEGER"),
          // Manual "we gave this person their money back" flag. A
          // redeemer's 25%-off code is worthless if they'd already paid
          // in full before the referral was redeemed (the code can't be
          // applied retroactively to a claim that's already
          // submitted/approved) — /admin/referrals surfaces that case so
          // an admin can refund the difference by hand and record it here.
          addColumnIfMissing("discount_credits", "refunded INTEGER NOT NULL DEFAULT 0"),
          addColumnIfMissing("discount_credits", "refunded_at TEXT"),
          // Where to actually send that manual refund. Many people pay
          // via a shop/kiosk bKash number rather than their own, so the
          // admin can't just look up "their" number — the redeemer has to
          // tell us which number to send to (see /dashboard/refer and
          // /api/referral/refund-number). NULL until they submit one.
          addColumnIfMissing("discount_credits", "refund_number TEXT"),
          addColumnIfMissing("discount_credits", "refund_method TEXT"),
        ])
      )
      .then(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_discount_credits_user ON discount_credits (user_id, created_at DESC);`
        )
      )
      .then(() =>
        // One row per signed-in device/browser for the app's own email+
        // password session (JWT-in-cookie, see lib/auth.ts). Lets
        // /profile show "where you're logged in" and revoke a device
        // remotely. NOT used for Google sign-in (that's a separate
        // NextAuth-managed cookie/session we don't have a table for —
        // see the note in lib/auth.ts).
        client.execute(`
          CREATE TABLE IF NOT EXISTS user_sessions (
            id            TEXT PRIMARY KEY,
            user_id       INTEGER NOT NULL,
            device_label  TEXT,
            ip            TEXT,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      )
      .then(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);`
        )
      )
      .then(() =>
        // One row per mock-test week number, holding the date an admin has
        // scheduled/announced for it (see /admin/mock-test). Purely a
        // display label on the dashboard's locked/upcoming week cards —
        // the actual "can this student start a test right now" gate is
        // still the rolling 7-day rule in lib/mock-test.ts and is
        // unaffected by whatever is set here.
        client.execute(`
          CREATE TABLE IF NOT EXISTS mock_test_week_schedule (
            week_number  INTEGER PRIMARY KEY,
            unlock_date  TEXT
          );
        `)
      )
      .then(() =>
        // One row per vocabulary word an admin has added (see
        // /admin/vocab-words). daily_date (YYYY-MM-DD) is set on the word
        // that should show as that day's Word of the Day on
        // /dashboard/vocab - at most one word per date, enforced by the
        // unique index below. Synonyms/examples are capped at two each per
        // the practice-card design, so plain columns (not a child table)
        // keep reads/writes simple.
        client.execute(`
          CREATE TABLE IF NOT EXISTS vocab_words (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            word            TEXT NOT NULL,
            pronunciation   TEXT,
            part_of_speech  TEXT,
            meaning_en      TEXT NOT NULL,
            synonym_1       TEXT,
            synonym_2       TEXT,
            example_1_en    TEXT,
            example_1_bn    TEXT,
            example_2_en    TEXT,
            example_2_bn    TEXT,
            daily_date      TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      )
      .then(() =>
        client.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_vocab_words_daily_date ON vocab_words (daily_date) WHERE daily_date IS NOT NULL;`
        )
      )
      .then(() =>
        // Per-student "Knew it" / "Still learning" status from the practice
        // flashcards - one row per (user, word), upserted as they swipe.
        // Powers the Mastered/Learning counts and filter tabs on
        // /dashboard/vocab.
        client.execute(`
          CREATE TABLE IF NOT EXISTS vocab_progress (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            word_id     INTEGER NOT NULL,
            status      TEXT NOT NULL,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, word_id)
          );
        `)
      )
      .then(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_vocab_progress_user ON vocab_progress (user_id);`
        )
      )
      .then(() =>
        // One row per completed Vocab Battle round — mode is 'solo' or
        // 'live' (PvP, see vocab_battle_matches below). Powers both the
        // Hi-Score badge and the Battle History panel on the arena page.
        client.execute(`
          CREATE TABLE IF NOT EXISTS vocab_battle_attempts (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id        INTEGER NOT NULL,
            mode           TEXT NOT NULL DEFAULT 'solo',
            score          INTEGER NOT NULL,
            correct_count  INTEGER NOT NULL,
            total_words    INTEGER NOT NULL,
            best_streak    INTEGER NOT NULL DEFAULT 0,
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      )
      .then(() =>
        // How long the round actually took, client-timed from the moment
        // questions loaded to submit (app/dashboard/vocab-battle/solo).
        // Nullable/absent on rows logged before this column existed —
        // the Performance page's time-spent total treats those as 0
        // rather than guessing, see app/api/performance/route.ts.
        addColumnIfMissing("vocab_battle_attempts", "duration_seconds INTEGER")
      )
      .then(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_vocab_battle_attempts_user ON vocab_battle_attempts (user_id, created_at DESC);`
        )
      )
      .then(() =>
        // Which live match this attempt belongs to (NULL for solo). Lets
        // the live results screen pull both players' rows for one match
        // instead of trusting whatever the client says about the opponent.
        addColumnIfMissing("vocab_battle_attempts", "match_id INTEGER")
      )
      .then(() =>
        // One row per Live Multiplayer match — random-matchmaking or
        // invite-by-room-code, both member-only (see requireActiveMember,
        // lib/api-auth.ts). `questions_json` is generated once, when the
        // second player joins, so both clients race through the exact same
        // words/options (see lib/vocab-battle-questions.ts) instead of each
        // getting their own random set.
        client.execute(`
          CREATE TABLE IF NOT EXISTS vocab_battle_matches (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            room_code       TEXT UNIQUE,
            source          TEXT NOT NULL DEFAULT 'invite',
            status          TEXT NOT NULL DEFAULT 'waiting',
            player1_id      INTEGER NOT NULL,
            player1_name    TEXT NOT NULL,
            player2_id      INTEGER,
            player2_name    TEXT,
            questions_json  TEXT,
            player1_score   INTEGER,
            player2_score   INTEGER,
            winner_id       INTEGER,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            started_at      TEXT,
            finished_at     TEXT
          );
        `)
      )
      .then(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_vocab_battle_matches_players ON vocab_battle_matches (player1_id, player2_id);`
        )
      )
      .then(() =>
        // Random-matchmaking waiting room: one row per member currently
        // looking for an opponent. A new joiner matches against whoever's
        // been waiting longest (see /api/vocab-battle/live/queue), then
        // both rows are deleted. UNIQUE(user_id) means hitting "Find Match"
        // twice just refreshes this row instead of double-queueing.
        client.execute(`
          CREATE TABLE IF NOT EXISTS vocab_battle_queue (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL UNIQUE,
            user_name         TEXT NOT NULL,
            matched_match_id  INTEGER,
            created_at        TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      )
      .then(() =>
        // One row per bug a student reports from /dashboard/report-bug.
        // developer_notes is written back by an admin (see
        // /admin/bug-reports) so the student can see a reply without a
        // separate messaging system. status drives both the student's
        // list badge and the admin filter tabs.
        client.execute(`
          CREATE TABLE IF NOT EXISTS bug_reports (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id           INTEGER NOT NULL,
            title             TEXT NOT NULL,
            description       TEXT NOT NULL,
            severity          TEXT NOT NULL DEFAULT 'medium',
            page_url          TEXT,
            status            TEXT NOT NULL DEFAULT 'open',
            developer_notes   TEXT,
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      )
      .then(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_bug_reports_user ON bug_reports (user_id, created_at DESC);`
        )
      )
      .then(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports (status, created_at DESC);`
        )
      )
      .then(() =>
        // In-app notification feed (bell icon in the dashboard header).
        // Keyed by user_email rather than user_id so it can be written to
        // from routes that only have an email on hand (e.g. the mock-test
        // scoring route, which reads the student's email off Supabase's
        // `students` table, not this DB's `users.id`). `link` is where
        // tapping the notification should navigate; `read` drives the
        // unread dot on the bell icon.
        client.execute(`
          CREATE TABLE IF NOT EXISTS notifications (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email  TEXT NOT NULL,
            type        TEXT NOT NULL,
            title       TEXT NOT NULL,
            body        TEXT,
            link        TEXT,
            read        INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      )
      .then(() =>
        client.execute(
          `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_email, created_at DESC);`
        )
      );
  }
  return ready;
}

/** Always await this before running a query — ensures the table exists. */
export async function getDb() {
  await init();
  return client;
}

export default client;
