# Handover: Supporting 25-minute Mock Tests

Written so someone else (another dev, or another Claude session) can pick
this up without needing to ask what's already been figured out. Nothing in
this document has been implemented yet — it's a plan based on Gemini's own
Live API docs, not verified against this app's actual behavior.

## The core problem

Right now, ANY test longer than ~10 minutes will silently break — before
even getting to the recording. There are two separate limits stacked on
top of each other, both from Google's side, neither currently handled:

1. **Every single WebSocket connection lives for ~10 minutes, period.**
   The server sends a `GoAway` message and closes it — this isn't an
   error, it's expected behavior on Google's end.
2. **Without `contextWindowCompression`, an audio-only session is capped
   at ~15 minutes of conversation total** (token-based history limit).
   Past that, the *session* — not just the connection — is terminated.

Neither is configured today — `app/api/mock-test/gemini-session/route.ts`
sets neither `sessionResumption` nor `contextWindowCompression`.

On top of that:
3. The ephemeral token's `expireTime` is currently hardcoded to 20
   minutes — shorter than a 25-minute test, with no buffer.
4. Separately (already flagged in STATUS.md before this): a 25-minute
   recording pushed through the current `upload-audio` API route risks
   exceeding the hosting platform's request body-size limit.

## What needs to be built — do these in order

### 1. `app/api/mock-test/gemini-session/route.ts` — cheap, do this first

- Add `contextWindowCompression: { slidingWindow: {} }` inside
  `liveConnectConstraints.config` — removes the 15-minute content cap.
- Add `sessionResumption: {}` in the same place, so the server starts
  sending `SessionResumptionUpdate` messages with a reconnect handle.
- Bump `expireTime` from 20 min to ~40–45 min (covers a 25-min test +
  reconnect overhead + a grading buffer).
- Sanity-check `uses: 1` — Google's docs say *resuming* a session doesn't
  count against `uses`, so 1 should still be enough even with a couple of
  reconnects, but confirm this against a real test run before trusting it.

### 2. `lib/gemini-live-client.ts` — the real work

- In `handleMessage()`, listen for `sessionResumptionUpdate` messages and
  keep the latest `handle` around.
- Listen for `goAway` messages. When one arrives, proactively open a NEW
  WebSocket connection on the same token and pass the saved handle as
  `sessionResumption: { handle }` in that connection's `setup` message —
  don't wait for the old connection to hard-fail first.
- Decide how to handle the ~1–2 second gap while swapping connections:
  either buffer mic audio locally during the swap so nothing said in that
  window is lost, or accept a small gap. Worth a quick decision with you
  before building it either way.
- The `MediaRecorder` is already tied to the shared `AudioContext`, not to
  the WebSocket, so it should keep recording straight through a reconnect
  automatically — just make sure the reconnect logic swaps `this.ws`
  rather than calling `close()` (which would tear the recorder down too).

### 3. Audio upload — already flagged, more urgent now at 25 minutes

- Replace the current server-proxy upload
  (`app/api/mock-test/upload-audio/route.ts`) with Supabase's
  signed-upload-URL flow: the server hands back a short-lived upload URL,
  the browser `PUT`s the recording straight to Storage, and the Next.js
  function's body-size limit never comes into play.
- Needs a new env var the app doesn't have yet:
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Suggested order to actually build this

1. Server config (#1) — low risk, unlocks testing everything else.
2. Reconnect logic (#2) — the real work; test locally with an actual
   12+ minute call before considering it done.
3. Upload flow (#3) — independent of #1/#2, only matters once a full
   25-minute recording actually exists to upload.

## Files involved

| File | What changes |
|---|---|
| `app/api/mock-test/gemini-session/route.ts` | token/session config (compression, resumption, expireTime) |
| `lib/gemini-live-client.ts` | reconnect + resumption logic; recording itself is already fine |
| `app/mock-test/session/page.tsx` | optional: a subtle "reconnecting..." indicator if the gap is noticeable |
| `app/api/mock-test/upload-audio/route.ts` | replaced/supplemented by a signed-URL upload flow |
| new env var | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

## A different kind of limit: concurrency at scale (120 students/day)

Everything above is a *per-test* limit — how long ONE conversation can
run. This section is about a *fleet* limit — how many tests can run **at
the same time**, which matters once real usage looks like ~120 students
testing on the same day, weekly.

- This app uses the **Gemini Developer API**
  (`generativelanguage.googleapis.com`, via `ai.authTokens.create`) — NOT
  Vertex AI. Vertex publishes a concrete number (1,000 concurrent
  sessions/project on PayGo); the Developer API does not publish an exact
  concurrent-Live-session cap. It scales with your project's **usage
  tier** (Free / Tier 1 / Tier 2 / Tier 3), which Google sets
  automatically based on cumulative billing spend — not something you
  pick directly.
- **Checked the current code for this pass:** `gemini-session/route.ts`
  has only a generic `try/catch` around token creation, and
  `gemini-live-client.ts`'s `ws.onerror` shows one generic
  "Gemini WebSocket এ connection সমস্যা হয়েছে" message for every failure
  type. Neither distinguishes a `429 RESOURCE_EXHAUSTED` (capacity/quota)
  from any other failure, and there's no retry/backoff. Today, if 120
  students hit this at once, they'd all see the same generic error with
  no "try again in a moment" behavior.
- **The risky scenario is 120 students starting within a narrow window**
  (e.g. everyone joining right when a weekly slot opens), not 120 spread
  naturally across a full day — concurrency is what the limit is on, not
  daily total.

### Action items
1. Check the project's actual current usage tier (Google AI Studio → API
   keys/usage, or Cloud Console → Gemini API quotas) — this tells you
   what's safe **today**, before any of the 25-minute changes above are
   even made.
2. Add real handling for a 429/quota error at both token-creation time
   (`gemini-session/route.ts`) and WS-connect time
   (`gemini-live-client.ts`) — at minimum a distinct, honest message like
   "সার্ভার এখন ব্যস্ত, একটু পরে আবার চেষ্টা করো" instead of the generic
   connection-error message, ideally with an automatic retry/backoff.
3. If it's realistic for your students, consider staggering start times
   (a few slots through the day) instead of one single weekly moment for
   all 120 — this alone would remove most of the actual risk.
4. If the current tier genuinely can't handle 120 concurrent, that's
   fixed on Google's side (spend more to raise tier automatically, or
   contact sales for Tier 3/Enterprise) — not something more code can
   solve.

## Known limitations — flag these to whoever tests this

- Context compression trims older parts of the conversation once
  triggered — the AI examiner may "forget" the very start of a 25-minute
  test. Probably fine since it's reading from a fixed question list
  (see the `systemInstruction` built in `gemini-session/route.ts`), but
  worth knowing.
- Reconnects are not instant; budget for a short audio gap (Google
  doesn't publish an exact number).
- More minutes = more billed tokens (~25 tokens/sec of audio, both
  directions). A 25-minute test costs meaningfully more per attempt than
  the current ~10-minute ceiling — worth a quick cost check before
  rolling this out to everyone, not just an engineering concern.
- Nothing here has been tested yet. Whoever implements this should run at
  least one real 15+ minute call through it before trusting it for actual
  students, since Google's stated limits are the best available
  documentation, not a guarantee of this specific app's behavior.
