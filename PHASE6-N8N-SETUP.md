# Phase 6 — Notification Automation: n8n Setup Guide

This app's side of Phase 6 is done (see `STATUS.md`'s latest entry) — two
integration points now exist for n8n to plug into. **This document is the
part that has to happen in your actual n8n instance**, which I don't have
access to, so nothing here has been tested end-to-end. Follow it, testing
each workflow manually inside n8n before turning on its trigger for real.

## What the app now exposes

| Plan §6 requirement | App-side piece | n8n-side piece |
|---|---|---|
| Routine passkey email before each shift | `GET /api/cron/speaking-club-roster?shiftNumber=N` — returns who's in which room this shift, with their passkey (see route file for the exact JSON shape) | **Workflow 1** below: Schedule Trigger → HTTP Request → Loop → Email |
| Reassignment email when admin resolves an alert or does a proactive move | Both reassignment routes now POST to `N8N_REASSIGNMENT_WEBHOOK_URL` if it's set (falls back to sending directly via Resend if not — see `lib/mailer.ts`'s `notifyReassignmentViaN8n()`) | **Workflow 2** below: Webhook → Email |

Both integration points are **optional and additive** — leave
`N8N_REASSIGNMENT_WEBHOOK_URL` blank and nothing changes from how Phase 5
already worked. This lets you build and test Workflow 2 in n8n without any
risk of double-sending reassignment emails while you're still setting it up
— the app only stops sending them directly once you actually fill in the
webhook URL.

## Prerequisites

- The app deployed somewhere with a real public URL (n8n needs to reach
  `/api/cron/speaking-club-roster` and your app needs to reach n8n's
  webhook — this doesn't work between two `localhost`s unless you tunnel).
- `CRON_SECRET` set in your deployment's env (falls back to `ADMIN_SECRET`
  if you skip it, but see the note in `.env.example` about why a separate
  one is better here).
- An n8n instance (cloud or self-hosted) you can log into.
- Some way for n8n to actually send email — either:
  - n8n's built-in **Send Email** node (SMTP credentials), or
  - an **HTTP Request** node calling Resend's API directly (same
    `RESEND_API_KEY` this app already uses, if you'd rather keep using
    Resend), or
  - a dedicated Resend/Postmark/SendGrid community node if your n8n
    instance has one installed.
  This guide uses "an Email node" generically — swap in whichever of the
  above you actually have.

---

## Workflow 1 — Routine passkey notification (§6, one workflow, 3 schedules)

Build one workflow with **three separate Schedule Trigger nodes** (one per
shift), each feeding into the same HTTP Request → Loop → Email chain, so
you don't maintain three near-identical workflows.

### 1. Schedule Trigger nodes (×3)

- Add a **Schedule Trigger** node for each shift, set to fire **15-30
  minutes before that shift's `start_time`** (check `sql/schema.sql` or
  the admin panel's Rooms & Shifts tab for the actual times you seeded).
- Set the timezone to **Asia/Dhaka** in each trigger's settings — the
  roster route's `startTime`/`endTime` are plain `HH:MM:SS` in Dhaka local
  time already (see `currentDhakaTime()` in `lib/speaking-club-db.ts`), no
  conversion needed once the trigger itself fires at the right Dhaka wall
  clock time.
- Give each one a distinct value to pass forward — easiest way: add a **Set
  / Edit Fields** node right after each trigger with a field
  `shiftNumber` set to `1`, `2`, or `3` respectively, so the next node can
  reference `{{$json.shiftNumber}}` regardless of which trigger fired.

### 2. HTTP Request node

- Method: `GET`
- URL: `https://YOUR-DOMAIN/api/cron/speaking-club-roster?shiftNumber={{$json.shiftNumber}}`
- Headers: `x-cron-secret` → your `CRON_SECRET` value (or `ADMIN_SECRET` if
  you didn't set a separate one)
- Response: JSON, with a top-level `roster` array — each item shaped like:
  ```json
  {
    "email": "student@example.com",
    "name": "Nadia R.",
    "roomCode": "room-12",
    "shiftNumber": 1,
    "passkey": "LC-R12-S1-A8X2",
    "startTime": "17:00:00",
    "endTime": "18:00:00",
    "role": "primary"
  }
  ```
  `role` is `"primary"` for the two regular seats or `"third"` for anyone
  currently added as a temporary 3rd person — you probably want the same
  email either way, but it's there if you want a slightly different
  subject line for 3rd-person adds.

### 3. Split Out node

- Add a **Split Out** node (or **Item Lists** on older n8n) pointing at
  the `roster` field from the HTTP Request node's output, so the Email
  node below runs once per student instead of once total.

### 4. Email node

- To: `{{$json.email}}`
- Subject suggestion: `তোমার Speaking Club room — {{$json.roomCode}}, Shift {{$json.shiftNumber}}`
- Body — pull in `{{$json.name}}`, `{{$json.roomCode}}`, `{{$json.shiftNumber}}`,
  `{{$json.passkey}}`, `{{$json.startTime}}`, `{{$json.endTime}}`. Keep the
  tone/branding consistent with `lib/mailer.ts`'s existing HTML templates
  (cream/leaf/ink, see `sendSpeakingClubReassignmentEmail()` for a
  reference template you can copy the styling from) if you want it to look
  like it came from the same product.

### Test before enabling

- Use n8n's "Execute Workflow" / pin-data test run first, with the
  Schedule Trigger disabled, to confirm the HTTP Request actually returns
  a non-empty `roster` for a shift you know has real assignments.
- Send yourself a test email through the Email node before turning the
  schedule live for real students.

---

## Workflow 2 — Reassignment notification (§4.2/§4.5/§6)

### 1. Webhook node

- Add a **Webhook** node, method `POST`.
- Under **Authentication**, either leave it `None` (the webhook URL itself
  is the secret, effectively) or pick **Header Auth** and set the header
  name to `x-webhook-secret` with whatever value you also put in this
  app's `N8N_REASSIGNMENT_WEBHOOK_SECRET` env var (recommended — see the
  comment on that var in `.env.example`).
- The incoming body will be exactly this app's `ReassignmentNotice` shape
  (from `lib/mailer.ts`):
  ```json
  {
    "to": "karim@example.com",
    "roomCode": "room-31",
    "shiftNumber": 1,
    "passkey": "LC-R31-S1-K9M4",
    "startTime": "17:00:00",
    "endTime": "18:00:00",
    "asThirdPerson": false
  }
  ```

### 2. Email node

- To: `{{$json.body.to}}` (n8n nests webhook payloads under `.body` by
  default — check the actual field path in your webhook's test output,
  older/newer n8n versions differ slightly here).
- Vary the message based on `{{$json.body.asThirdPerson}}` — `true` means
  "you've been added to an active session as a 3rd person", `false` means
  "you've been moved to a different room" (see
  `sendSpeakingClubReassignmentEmail()` in `lib/mailer.ts` for the exact
  wording this app used for the direct-send version — copy it for
  consistency if you like).

### 3. Respond to Webhook node

- Add a **Respond to Webhook** node at the end, status `200`.
- This app's `notifyReassignmentViaN8n()` treats any non-2xx response (or
  a network failure, or a timeout) as "n8n didn't take it" and **falls
  back to sending the email directly itself** — so make sure this
  responds quickly and with a 2xx once the workflow has genuinely queued
  the email, or you'll end up with both n8n's and the app's own send
  racing (harmless double-email, not a crash, but annoying for the
  student).

### 4. Activate and wire up the URL

- Activate the workflow in n8n, copy the webhook's **Production URL**
  (not the Test URL — Test URLs only fire once per manual click in the
  n8n editor).
- Set `N8N_REASSIGNMENT_WEBHOOK_URL` (and `N8N_REASSIGNMENT_WEBHOOK_SECRET`
  if you used Header Auth) in the app's real deployment env, redeploy.

### Test before relying on it

1. Trigger a real reassignment from the admin panel (Alerts tab → Reassign,
   or the Proactive reassignment form) with "notify" checked.
2. Check n8n's execution log — the webhook should show a new execution
   with the expected payload.
3. Confirm the student actually received the email through n8n's Email
   node, **not** a second copy from the app's own Resend send (if you see
   two emails, the webhook call likely isn't returning a 2xx fast enough —
   check the Respond to Webhook node is actually reached and not blocked
   behind a slow email-send step; consider putting Respond to Webhook
   right after receiving the payload and doing the actual send
   asynchronously if your n8n plan supports it).
4. Temporarily blank out `N8N_REASSIGNMENT_WEBHOOK_URL` and confirm a
   reassignment still emails the student directly (Phase 5's fallback) —
   this is your safety net if n8n is ever down.

---

## Notes / things I couldn't verify

- **Exact Dhaka-time cron expressions for the Schedule Trigger nodes** —
  depends on the actual `start_time` values you seeded in
  `sql/schema.sql`, which I don't have from inside this sandbox. Pull them
  from the admin panel's Rooms & Shifts tab before setting the three
  triggers.
- **n8n's webhook payload field path** (`$json.body.to` vs `$json.to`)
  varies by n8n version — check your instance's actual test-webhook output
  before wiring the Email node's fields, rather than trusting the path
  above blindly.
- **Not tested against a real n8n instance or real email delivery** — I
  built the app-side contract (the roster route's JSON shape, the webhook
  payload shape, the fallback behavior) and reviewed it by hand, but the
  actual n8n workflows described above only exist as instructions, not as
  something I ran.
