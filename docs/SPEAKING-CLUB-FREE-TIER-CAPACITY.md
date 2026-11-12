# Speaking Club on free tiers: 3 slots x 100 students

Schedule: 3 slots a day, 50 rooms x 2 = 100 students per slot, 300 students a day, one hour each, everyone
finishing together. Nothing here needs a paid plan, but three numbers need watching.

## Vercel Hobby (1,000,000 function invocations and 1,000,000 edge requests a month)
Audio never touches Vercel (WebRTC peer to peer; signaling on Supabase Realtime; transcription from the browser
with the student's own Gemini key). Vercel only sees small API calls. Per student per one-hour call:

| call | before | now |
|---|---|---|
| presence heartbeat | every 45 s = 80 | every 120 s = 30 |
| shared words poll | every 30 s = 120 | every 5 min = 12 (+ instant refresh on the realtime ping and when the tab is shown again) |
| join, turn credentials, cue cards, my-status, submit, stats | ~10 | ~10 |
| **total** | **~210** | **~52** |

300 students x 52 = ~15,600 a day = ~470,000 a month if the club runs every day of the month (before: ~1.9 million,
over the free limit). Normal page views and the rest of the site use the same two 1M budgets: check
Vercel -> Usage after the first week.
Hobby is also "non-commercial use only" in Vercel's terms; that is a licence matter, not a technical limit.

## Supabase Free (Realtime: 200 concurrent connections, 100 messages/s, 100 channel joins/s)
One browser tab = one connection. 100 students in a call = 100 connections. A Vocab Battle played in the same hour
uses the same pool, so keep an eye on "Realtime connections" in the Supabase dashboard: over 200, new joins are refused.

## Gemini free tier (the site's feedback key)
See `docs/speaking-club-ai-feedback.md`. The worker is now paced and survives 429s; set `FEEDBACK_WORKER_RPM` from
the limits shown in Google AI Studio for your project. Each student's own key (transcription) is separate and
unaffected by this.

## Vocab Battle inside calls: traffic changes (300 students/day)
What a battle used to cost, per player, and what it costs now:

| step | before | now |
|---|---|---|
| waiting for the partner to accept | HTTP poll every 2 s, no time limit (an ignored invite polled forever) | one Realtime "joined" nudge; 6 s fallback poll; gives up after 3 min |
| waiting for the opponent's result | poll every 2 s for up to 60 s, each poll re-sending the whole question set | one Realtime "finished" nudge; 6 s fallback poll for up to 2 min; polls are `?lite=1` (no questions) |
| building a round | read the ENTIRE vocab_words table from Turso on every battle start | word bank cached in memory for 10 min per server instance |
| second finisher | polled for the result | the attempts response says `finished`, so one fetch |
| emoji reactions | up to 1 per 0.7 s per player | 1 per 1.5 s (keeps Realtime messages/s low when many rooms play at once) |

A battle is now roughly 8-10 function calls per player instead of 30-60.
Also: the secondary Realtime channels (battle invites, shared words) join after a random 0-3 s delay, so 100 students
opening their room at the same second don't hit Supabase Free's 100 channel-joins/second limit (the call's own
signaling channel still joins immediately).
