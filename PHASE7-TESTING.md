# Phase 7 — Monitoring & Hardening — handoff / testing notes

Implements plan §9 Phase 7. Read this alongside `SPEAKING-CLUB-WEBRTC-PLAN.md`
§7 and §9 Phase 7 for the original ask.

## ⚠️ Read this part first — what Phase 7 actually is

Phase 7 is explicitly scoped in the plan as **"post-launch, ongoing"**, and
depends on "everything above being live." That's a different kind of phase
than 1–6: those produced code that could be built and reviewed ahead of
real usage. Phase 7's actual deliverables —

- watch real TURN relay usage for 1–2 weeks against the estimate in §7
- watch real partner-absent frequency and decide if Phase 5's manual
  process needs more automation
- general bug-fixing based on real usage patterns

— **cannot be completed from this sandbox**, because they require real
students, real calls, and real time passing. There is no code that
substitutes for that. What this pass *did* build is the **infrastructure
those decisions need** — so that once the feature is live, the answers are
a page load away instead of a manual DB query, and nothing about the 1–2
week monitoring window is blocked on more engineering work.

## What's new this pass

### 1. TURN usage logging (§7's literal ask)
- **`sql/schema.sql`** — new `speaking_turn_usage` table. One row per
  participant per call, written by the browser when a call ends. Same
  default-deny RLS posture as every other Speaking Club table.
- **`hooks/use-speaking-room-call.ts`** — `collectRelayStats()` reads each
  `RTCPeerConnection`'s `getStats()` for the *nominated* candidate pair and
  checks whether its local candidate is `type: "relay"` (i.e. that peer
  specifically needed TURN, not just direct P2P — tracked per-connection
  since a room can have one peer on TURN and the other on direct P2P at
  the same time). `finalizeAndReportUsage()` aggregates this across every
  peer connection in the room and calls `reportTurnUsage()`, which POSTs to
  the new route below via `navigator.sendBeacon` (falls back to
  `fetch(..., { keepalive: true })`) — `sendBeacon` specifically because
  the most common way a call ends is the tab closing, which `fetch` can
  get cancelled mid-flight during. Runs on both cleanup paths: the room
  page unmounting and the explicit "leave call" button.
- **`app/api/speaking-club/turn-stats/route.ts`** — new. `requireUser()`,
  same "must actually be assigned to this shiftId" check as
  `presence/heartbeat/route.ts`, same "no real shiftId → nothing to
  report" rule for the Phase 2 dev test-identity path. Clamps bytes/
  duration to sane upper bounds so a client bug can't poison the
  Monitoring tab's totals.
- **`lib/speaking-club-db.ts`** — `recordTurnUsage()` (the insert) and
  `getTurnUsageSummary()` (aggregates the last N days into per-day
  totals, a relay-rate percentage, and a rolling current-month total to
  compare against Cloudflare's 1000 GB free quota — plan §7's own
  estimate was ~40–60 GB/month realistic, ~202 GB/month worst case).

### 2. Reassignment frequency (§9 Phase 7's second ask)
- **No new table needed** — `speaking_reassignments` (Phase 5) was
  written with exactly this in mind; its own schema comment says it
  "gives Phase 7 a history to audit real reassignment frequency against."
- **`lib/speaking-club-db.ts`** — new `getReassignmentFrequencySummary()`:
  last-30-days counts by reason (`partner_absent` vs `proactive_conflict`)
  plus the current count of still-open alerts.

### 3. Admin panel — new "Monitoring" tab
- **`app/api/admin/speaking-club/monitoring/route.ts`** — new,
  `requireAdmin()`, bundles both summaries above into one response.
- **`app/admin/speaking-club/page.tsx`** — new `MonitoringTab` +
  `StatCard` components: TURN usage vs the free quota (with a simple
  green/amber/red progress bar), relay-rate percentage, reassignment
  counts, an open-alerts nudge if any are outstanding, and a per-day
  table. Loads lazily the first time the tab is opened (this data changes
  slowly — no reason to fetch it before anyone looks, unlike Rooms/Alerts
  which load on unlock).

## ⚠️ Not tested — same caveat as every previous phase, still true here
This sandbox has **no `node_modules` and no network to install one** (a
plain `npm install` fails with `403 Forbidden` against the npm registry —
confirmed this pass), so not even `npx tsc --noEmit` could run. Every file
above was hand-matched against the existing codebase's exact patterns
(`recordPresenceHeartbeat`/`presence/heartbeat/route.ts` for the
report-a-fact-about-a-shift shape, `requireAdmin`/`requireCron` for auth,
the Alerts tab's load/loading/error state shape for the Monitoring tab)
and manually reviewed for brace/paren balance and type consistency, but:
**run `npx tsc --noEmit` and `next lint` for real before deploying**, then
work through the checklist below.

## Test checklist (once you have a real browser + deployed environment)

1. **Basic report path:** join a 2-person room, let it connect, leave
   normally (the "leave call" button). Check the `speaking_turn_usage`
   table got a row for each participant with plausible `call_duration_seconds`.
2. **Direct P2P case:** on a network where you're confident both peers can
   reach each other directly (e.g. same LAN), confirm `used_relay = false`
   and `relay_bytes_sent`/`received` are both `0` for that call — the
   report should still land (a `0` row is a real, useful data point, not a
   failure).
3. **Forced-TURN case:** reuse Phase 2's forced-relay test path
   (`iceTransportPolicy: "relay"`, see `PHASE2-TESTING.md`). Confirm
   `used_relay = true` and the byte counts are nonzero and roughly sane
   for the call's length (§7's estimate: ~0.045 GB/hour combined).
4. **Tab-close path (not the Leave button):** join a call, then just close
   the browser tab instead of clicking Leave. Confirm a row still shows up
   — this is what `sendBeacon` is specifically for; if it's missing, check
   whether the deployed environment's CSP/headers block `sendBeacon` to
   your own origin (shouldn't, but worth ruling out first).
5. **3-person room:** confirm `peer_count = 3` shows up correctly and that
   a 3-person room doesn't produce 3x-inflated relay bytes for a single
   "session" (each participant's own peer-connections are summed
   per-participant by design — plan §7 already expects 3-person rooms to
   move usage "marginally," so this is about confirming the number looks
   marginal, not zero and not doubled).
6. **Monitoring tab, empty state:** before any real calls exist, confirm
   the tab shows the "no usage reported yet" empty state instead of an
   error.
7. **Monitoring tab, with data:** after test calls above, confirm the
   summary cards, quota bar, and daily table all show numbers that match
   what you'd compute by hand from the `speaking_turn_usage` rows.
8. **Quota bar color thresholds:** these are cosmetic (green under 50%,
   amber 50–80%, red over 80% of the 1000 GB monthly quota) — no need to
   actually burn 500+ GB to test, just sanity-check the math reads right
   at the current low usage level.
9. **After that:** let it run for real for 1–2 weeks per §7, then look at
   the Monitoring tab and decide:
   - Is the real relay rate closer to §7's "20–30%" estimate or something
     else? (Matters for whether Cloudflare's free tier stays comfortably
     sufficient as usage grows beyond the current ~300 students/day.)
   - Is `reassignmentFrequency.totalLast30Days` low enough that Phase 5's
     manual admin-driven process is fine long-term, or high enough to be
     worth automating further (plan §9 Phase 7's own framing of this
     decision)?

## Known gaps, deliberately left as-is

- **No historical retention policy on `speaking_turn_usage`.** It's an
  append-only log with one row per participant per call — at ~300
  calls/day × 2–3 rows, this stays small for a very long time (see the
  schema comment), so no cleanup job was added speculatively. Revisit if
  it's ever actually large.
- **`getTurnUsageSummary()` always looks at the last 14 days**, not a
  configurable range — fine for the "watch the first 1–2 weeks" ask; if
  you want a longer historical view later, that's a small change to the
  `days` parameter and an admin-panel date picker, not a redesign.
- **The Monitoring tab doesn't auto-poll** (unlike the Alerts tab's 60s
  poll) — this data changes over hours/days, not minutes, so a manual
  reload is enough; add polling later only if that assumption turns out
  wrong.
- **No per-student or per-room breakdown**, only daily totals — the plan's
  own ask is about the aggregate relayed-GB-vs-quota picture and the
  aggregate reassignment-frequency picture, not per-student auditing. Add
  a drill-down later only if a real need for it shows up.
- **A general "bug-fixing based on real usage patterns" pass genuinely
  can't happen yet** — every prior phase's own "Known gaps" sections
  (`PHASE2-TESTING.md` through `PHASE5-TESTING.md`'s) list some
  deliberate, reasoned-about scope cuts, not bugs — none of them looked
  like something to "fix" blind, without the real usage data this exact
  phase is about collecting. Once the Monitoring tab has a couple of
  weeks of real numbers, that's the right time to revisit those lists
  with actual evidence instead of guessing.
