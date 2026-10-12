# Speaking Club AI feedback — transcript-only, transcribed AFTER the call

Feedback is generated from TEXT only. No audio is ever uploaded to the server.

## How it works
1. **One-time setup pop-up** (dashboard, mandatory, every browser): the student taps
   "ডাউনলোড করুন" once to fetch a small Whisper model (~60 MB tiny / ~100 MB base incl. ONNX
   runtime) into the browser cache. Shows size + mobile-data warning, can't be skipped, room
   redirects back to the dashboard if it isn't done. Never shown again on that device
   (flag `lc_whisper_ready:<model>` in localStorage, verified against Cache Storage).
   `NEXT_PUBLIC_WHISPER_SETUP_REQUIRED=false` switches the requirement off.
2. **During the call — listen only** (`lib/speaking-whisper-client.ts`, `SpeakingAudioCapture`):
   takes the call's OWN mic track (wrapped, not cloned → call mute respected, no second mic
   capture), resamples to 16 kHz, cuts speech into utterances (energy VAD, silence dropped) and
   keeps them as 16-bit audio in memory + mirrored to the device's IndexedDB. NO model runs and
   nothing is transcribed, so the conversation is exactly as smooth as without AI feedback.
   Cap: ~30 min of speech per call (oldest dropped beyond that). The chip in the room shows
   "কথা জমা হচ্ছে ✓".
3. **After the call — mandatory wait with a timer** (`lib/speaking-post-call.ts`): on Leave, the
   student sees a full-screen "AI Feedback তৈরি হচ্ছে" screen (`components/speaking-club/post-call-banner.tsx`,
   mounted in `app/layout.tsx`) with a progress bar (utterances done/total), a running "সময় লেগেছে m:ss"
   clock and an estimate of the time left. They stay until it finishes, however long their device
   needs (screen is kept awake via Wake Lock where supported; `beforeunload` warns on close).
   Behind it, on their device: load Whisper in a Web Worker → transcribe utterance by utterance →
   submit the TEXT to `/api/speaking-club/submit-transcript` (unchanged shape; Gemini worker unchanged,
   text only) → delete the audio. At the end: "✓ শেষ" + "চালিয়ে যান". No speech captured = no wait
   screen. If it fails, the wait screen closes and a small banner explains it will retry later.
   Sessions resumed from an earlier visit use a small non-blocking banner instead.
   The Performance page's last-submit line records the model and seconds it took (e.g.
   `whisper whisper-base.en 74s`) so real waiting times can be judged.
4. **Nothing is lost if the tab closes** (`lib/speaking-segment-store.ts`): leftover sessions in
   IndexedDB are finished by `resumePendingSessions()` on any later page load / tab focus
   (a "capturing" session whose heartbeat is >90 s old counts as abandoned). Failure handling:
   submit fails (network/5xx/401) → the TEXT is kept and retried on later visits (max 5 attempts,
   max 3 days); 400/403/404 → dropped; model fails to load → audio kept and retried; if only partial
   work is possible the text we have is submitted.

## Web Speech API
Only an emergency backup (device can't run the model, or setup requirement switched off).

## Models
desktop (>=4 cores, >=4 GB): `Xenova/whisper-base.en`; phones / low-end: `Xenova/whisper-tiny.en`.
Because transcription now happens after the call (no competition with the live call for CPU),
the heavier base model on desktop is fine. Env: `NEXT_PUBLIC_WHISPER_MODEL`,
`NEXT_PUBLIC_WHISPER_REMOTE_HOST` (self-host model files).

## Trade-offs
- After a call the student waits on the wait screen while their own device produces the text — roughly
  1-3 min, more for long calls / slow devices (the wait is the price of keeping the call itself smooth
  and the voice off the server). A bigger model = better accuracy but a longer wait.
- Voice stays only on the student's own device, only until the text is submitted.
- Whisper-tiny/base is less accurate than cloud STT, especially for strong accents.

## Removed
Audio recording/upload fallback (`lib/speaking-audio.ts`, `/api/speaking-club/audio-upload-url`,
audio handling in worker/submit route/retention). `speaking_feedback.audio_path` is left in the
DB, unused.

## Build notes
`next.config.mjs`: alias `sharp`/`onnxruntime-node` to false; `swcMinify: false` (Next 14's SWC
minifier chokes on onnxruntime-web's `import.meta`). Verified: `tsc --noEmit` clean, `next build`
OK, segmenter + IndexedDB store + post-call engine unit-tested in Node (fake worker/fetch).
NOT verified in a real browser: test on a real Android phone, iPhone, Firefox and Edge.

## Known risks / things to watch (from the final review)
- Whisper (like any speech-to-text) tends to "smooth over" learner errors and drops fillers, so
  some real grammar mistakes can disappear from the transcript. Judge feedback quality on real calls.
- Accuracy for strong accents is lower than cloud STT; bigger model = better but longer mandatory wait.
- The ONNX runtime wasm (~21 MB) is fetched from jsDelivr; if that CDN is blocked on a network, transcription
  fails there (it then retries later). Self-hosting it is a possible follow-up.
- VAD thresholds were only tested on synthetic audio; a very quiet mic may need tuning
  (`SpeechSegmenter.thresholds()` in `lib/whisper-segmenter.ts`).
- Phones may pause a backgrounded tab; the wait screen asks to stay and requests a screen Wake Lock.
- The server now skips a re-sent identical transcript for the same shift+student (retry safety).
- Every student/teacher who opens the dashboard must do the one-time download (switch off with
  `NEXT_PUBLIC_WHISPER_SETUP_REQUIRED=false`).
