# Speaking Club — AI feedback

How a Speaking Club call becomes written AI feedback. **By default (every flag
below left unset) text only: no audio ever leaves the student's device.**

## Where a student's voice can go (and only there)

| Setting | Where the student's own speech goes |
|---|---|
| nothing set (default) | nowhere. It is transcribed on the student's own device; only the resulting **text** is sent to the server. |
| `NEXT_PUBLIC_PEER_OFFLOAD=true` | a slow device may send its speech, compressed, to the **partner it is in the call with** (who already hears it live), over the call's own data channel. Not through any server. |
| `NEXT_PUBLIC_CLOUD_TRANSCRIBE=true` | a slow device may send short chunks to **our server route**, which relays them to Groq's hosted Whisper using **our single** `GROQ_API_KEY` and returns the text. The route stores and logs neither audio nor text. |

Nobody else's speech is ever sent to a student, and no student or partner supplies
an API key: the cloud path uses one key owned by the project. If the voice must
stay on the student's own device only, leave both flags unset.

## The idea in one paragraph

The student's own speech is turned into text **on their own device** by a small
Whisper model running in a Web Worker. While the call runs, devices with enough
headroom already transcribe in the background, so even a one-hour call is mostly
done when it ends. Whatever is left is finished in the background (no wait screen; small top banner). Then only
the **text** is sent to the server, which queues it, asks Gemini for a summary and
a list of mistakes, and shows the result on the Performance page.

## Flow

```
STUDENT'S DEVICE
 1. One-time setup      dashboard pop-up → download Whisper tiny (~60 MB) → cached in the browser
 2. During the call     call's mic track → 16 kHz → speech cut into utterances (silence dropped)
                        → mirrored to IndexedDB (crash safety)
                        → [every device that can run the model] merged into ~12 s chunks (22 s when the device falls behind) and
                          transcribed in a background worker WHILE the call runs
 3. Call ends           the student is NOT held: leftover chunks finish in the background
                        (small top banner, budget 45 min); text is submitted when done
 4. Submit              TEXT only → POST /api/speaking-club/submit-transcript; audio deleted

SERVER
 5. Submit API          login + shift check; one session = one row (only text > 60,000 chars is split into parts);
                        each part becomes a `pending` row in speaking_feedback (no duplicates)
 6. Cron worker         ~every minute, rate-limit-aware pull of pending rows → Gemini (text in, JSON out)
                        → summary + mistakes saved; failures retry (3x) and record last_error
 7. Student sees it     Performance page ("Recent Speaking Club Feedback"), Mistake Log
```

## Code map

| Concern | File |
|---|---|
| All env settings and tunable limits | `lib/speaking-club/config.ts` |
| Device capability checks | `lib/speaking-club/device.ts` |
| Pure audio logic: resampler, speech cutter, text cleaner, chunk merging, sampling order | `lib/speaking-club/audio/segmenter.ts` |
| In-call capture of the call's mic track (+ live transcription feed) | `lib/speaking-club/audio/capture.ts` |
| Whisper worker (model load + self-test + transcribe) | `lib/speaking-club/transcription/whisper.worker.ts` |
| One worker + chunk queue, live and after the call | `lib/speaking-club/transcription/chunk-transcriber.ts` |
| Typed messages to/from the worker | `lib/speaking-club/transcription/protocol.ts` |
| Which model, is it downloaded on this device | `lib/speaking-club/transcription/model.ts` |
| One-time download state machine (the dashboard pop-up) | `lib/speaking-club/transcription/model-setup.ts` |
| Device-local safety net (IndexedDB) | `lib/speaking-club/storage/segment-store.ts` |
| After-call engine: finish, submit, retry, resume | `lib/speaking-club/post-call/engine.ts` |
| Last-submit diagnostics (Performance page) | `lib/speaking-club/submit-log.ts` |
| Long-transcript splitting (pure) | `lib/speaking-club/transcript-split.ts` |
| React glue: Web Speech backup, capture hand-off | `hooks/use-speaking-club-transcript.ts` |
| UI: setup pop-up / wait screen + banner | `components/speaking-club/whisper-setup-dialog.tsx`, `post-call-banner.tsx` |
| Submit API, queue, Gemini worker | `app/api/speaking-club/submit-transcript`, `lib/speaking-feedback-db.ts`, `lib/speaking-feedback-worker.ts`, `app/api/cron/speaking-club-feedback-worker` |

## Behaviour on different devices

| Device | During the call | After the call |
|---|---|---|
| Any device that can run the model | transcribes live in the background | usually little left: finished in the background, no wait screen |
| Same, but too slow to keep up | live work **throttles** (~50% duty) instead of stopping | leftover finished in the background (budget 45 min), no wait screen |
| Weak device | transcribes live too, throttled so the call stays smooth | whatever is left is finished after the call |
| Cannot run the model (no WASM/Worker/AudioContext, < 1 GB) | not captured | Web Speech API backup, if the browser has it |

## Failure handling

- **Tab closed / crash / offline:** speech is mirrored in IndexedDB; the next page load
  (or tab focus) finishes it (`resumePendingSessions`). Max 5 attempts, 3 days.
- **Submit fails (network / 5xx / 401):** the *text* is kept and retried later. 400/403/404 → dropped.
- **Model cannot load or run:** audio kept and retried; the worker's **self-test** (one second
  of silence) catches a model that loads but cannot run, during setup instead of mid-call.
- **No mic track from the call for 20 s:** the room chip tells the student capture is not working.
- **Gemini fails:** 3 attempts, reason stored in `speaking_feedback.last_error`.
- **Same text re-sent:** the server reuses the existing row (no duplicate feedback).

## Configuration

All optional. `NEXT_PUBLIC_*` values are baked in at build time (redeploy after changing).
Documented in `.env.example`; implemented in `lib/speaking-club/config.ts`.

| Variable | Effect | Default |
|---|---|---|
| `NEXT_PUBLIC_WHISPER_MODEL` | Whisper checkpoint (`Xenova/whisper-base.en` = more accurate, too slow for live on most devices) | `Xenova/whisper-tiny.en` |
| `NEXT_PUBLIC_WHISPER_REMOTE_HOST` | serve model files from your own storage/CDN | huggingface.co |
| `NEXT_PUBLIC_WHISPER_LIVE` | `false` = never transcribe during the call | on |
| `NEXT_PUBLIC_WHISPER_SETUP_REQUIRED` | `false` = students may enter a call without the download | required |
| `NEXT_PUBLIC_WHISPER_MAX_WAIT_SEC` | only used if a blocking wait is ever re-enabled (currently never blocks) | 240 |
| `GEMINI_TEXT_MODEL` | Gemini model for feedback / mistake quiz | `gemini-3.1-flash-lite` |
| `GEMINI_SPEAKING_FEEDBACK_API_KEY` | key for the feedback worker | — |

Operational limits (memory cap, retry counts, timeouts, throttle thresholds) live in
`LIMITS` in `config.ts`.

## Database

`sql/schema.sql` is safe to re-run at any time. One-off repairs live in `sql/migrations/`
(e.g. `2026-10-12-requeue-failed-speaking-feedback.sql`: re-queue rows that failed while the
old Gemini model was switched off — run once).

One session = one feedback row = one Gemini call, so the IELTS-examiner report judges the WHOLE
transcript at once (a full hour is ~20-45k characters). The mistake list is not capped (every mistake is
still logged, as before), so one call over a full hour takes longer than the old 16k-character calls did.
Only an unusually long text (> `PART_CHARS` = 60,000 characters) is still split into several rows
(only the first carries the topic/cue cards so later parts aren't flagged "off topic").

## Testing

```
npm test            # unit tests (vitest): pipeline logic, no real browser/model/network
npm run typecheck
```

`tests/speaking-club/` covers: speech cutting and resampling, text cleaning, chunk merging
and sampling, the IndexedDB store, live transcription (keeping up, throttling, load failure),
the after-call engine (retry, resume, budget sampling, full hour, who sees the wait screen),
config/device gates and transcript splitting.

**Not covered by automated tests (needs a real device):** the model actually transcribing
on a phone, `AudioContext`/worklet behaviour on iOS Safari, the call's mic track in WebRTC,
and Gemini's real responses. Before releasing, make a real call on Android, iPhone, Firefox
and desktop Chrome and check the Performance page's last-submit line, e.g.
`whisper whisper-tiny.en 18s (load 4s, chunks 55/55)` (`chunks X/Y` with X = Y means the whole
call was transcribed).

## Capacity planning (many students at once)

Everything up to "Submit" runs on the students' own devices (or with their own Gemini key), so it
scales with the number of students at no server cost. The shared resource is the **feedback worker +
Gemini key of the site**.

The real schedule: 3 slots a day, 50 rooms x 2 students = 100 students per slot, and all 100 finish
at about the same time. That is **100 rows per slot** (one per student), 300 a day.

- The cron route (hit about once a minute) answers `202` at once and keeps working in the background
  (`waitUntil`, up to 300 s on Vercel Hobby with Fluid Compute), so cron-job.org no longer shows a
  false "timeout" for a run that takes about a minute. `?wait=1` runs it in the foreground and returns the
  summary (for testing). The summary is also written to the function logs.
- Pacing is counted **from the database** (`claimed_at`), so overlapping runs share one budget:
  at most `FEEDBACK_WORKER_RPM` calls started per minute (default 10) and `FEEDBACK_WORKER_CONCURRENCY`
  in flight (default 6). 100 rows therefore drain in about 10-15 minutes after a slot ends; the last student's
  feedback arrives last. A day is ~300 requests.
- One Gemini call is cut off after `FEEDBACK_WORKER_CALL_TIMEOUT_MS` (150 s) and counted as a normal failed
  attempt (3 attempts), so a stuck call can no longer hang a run until Vercel kills it.
- A Gemini **429** (per-minute or daily quota, or token limit) does **not** use up an attempt: the row goes
  back to the queue, `last_error` says why, and the whole queue pauses for Gemini's "retry in Ns" hint (20 s to
  10 min; 30 min when the daily quota is used up). Feedback then simply arrives later, it does not fail.
- Google no longer publishes the free-tier numbers per model in its docs; read the real RPM / TPM / RPD for your
  project in Google AI Studio -> Rate limits and set `FEEDBACK_WORKER_RPM` below the RPM shown there.
- Measure one real call (admin monitoring page) on the first slot. If calls take well over 60 s nothing needs changing,
  but expect the drain to take longer.
- If the Vercel project cannot use Fluid Compute, `maxDuration` must go back to 60 in the route, with
  `FEEDBACK_WORKER_BUDGET_MS=20000` and `FEEDBACK_WORKER_CALL_TIMEOUT_MS=35000`.

## Known limits

- Whisper-tiny is less accurate than cloud speech-to-text, especially for strong accents, and
  like any speech-to-text it tends to smooth over learner errors.
- A device that is far slower than the speech arrives cannot transcribe a full hour within the
  wait budget; the call is then represented by an even sample.
- The ONNX runtime (~21 MB) is fetched from jsDelivr; if that CDN is blocked on a network,
  transcription fails there (and is retried later). Self-hosting it is a possible follow-up.
- Gemini's per-project rate limits are only visible in Google AI Studio; the worker starts at most 10 calls a minute.


## BYOK Gemini (default): the student brings their own key

* Setup pop-up (mandatory, same gate as the old model download): the student pastes a free Gemini API key
  from aistudio.google.com/apikey, ticks the consent box (18+, audio goes to Google with their key), and the key
  is tested with one tiny request before it is saved to localStorage. No key = no entry to a call.
* `lib/speaking-club/transcription/byok.ts` calls Gemini straight from the browser (key in the
  `x-goog-api-key` header, never in the URL). `GeminiByokWorker` answers the same messages as the Whisper
  worker, so live capture, the queue, resume and the post-call engine are unchanged.
* Every phone that can record works (no RAM / WASM check). Chunks are 25 s (fewer requests = less free-quota use).
* 429: retried twice; a long `retryDelay` means the quota is used up, so the chunk is skipped. 400/401/403 mid-call
  clears the "ready" flag, so the pop-up asks for a new key next visit.
* Switch back to Whisper: `NEXT_PUBLIC_GEMINI_BYOK=false`. Model: `NEXT_PUBLIC_GEMINI_MODEL`.
* Not verified from a real browser: CORS for direct calls, the free-tier daily quota, and the default model name.

## IELTS-examiner style feedback (Speaking Club only)

* `lib/speaking-ielts-feedback.ts` holds the examiner instruction, the extra response schema (`ielts_report`) and the
  formatter. The worker adds them for `source = speaking_club` only; Mock Test is unchanged.
* Gemini reads the whole transcript and gives an estimated band for Fluency & Coherence, Lexical Resource and
  Grammatical Range & Accuracy (with what worked, up to 3 "you said / better" fixes each), plus 3 next steps.
  Pronunciation is NOT scored (text transcript). The overall band is the average of the 3, computed in code.
* Under 100 words of speech: no bands are printed.
* Stored as readable text in `speaking_feedback.feedback_summary` (first line = headline), so there is no DB migration;
  the performance and admin pages now keep line breaks (`whitespace-pre-line`).
* `mistakes[]` and `mistake_logs` are untouched (categories still grammar/vocabulary/pronunciation/fluency/coherence,
  which map 1:1 onto the IELTS criteria), so the mistake quiz generator keeps working.
* If `ielts_report` is missing or malformed, the plain summary is stored, as before.
* Mistake categories are defined by the IELTS criteria in the prompt (`MISTAKE_CATEGORY_INSTRUCTION`): grammar =
  Grammatical Range & Accuracy, vocabulary = Lexical Resource (incl. word formation), fluency + coherence =
  Fluency & Coherence, pronunciation = Pronunciation (only when the text clearly implies it). Used for Speaking Club
  and Mock Test (one shared `mistake_logs` table); the category names are unchanged. Already-logged mistakes are not
  re-categorised.
