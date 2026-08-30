# Phase 2 — Testing Guide (Core Call Flow)

This sandbox that wrote this code has **no internet access** beyond a small
allowlist (npm/pip registries, GitHub) — it cannot reach Supabase Realtime,
Cloudflare's TURN API, or a real browser with microphone access. Everything
below has been **type-checked** (`npx tsc --noEmit` — zero errors, including
every new file) but **not exercised as a live call**. Please run through
this checklist yourself before marking Phase 2 done, per the plan's own
rule: *"Don't mark Phase 2 done based on the 2-person case alone."*

## What was built

| Plan §9 Phase 2 requirement | File |
|---|---|
| Supabase Realtime channel per `room_code` | `lib/webrtc/signaling-channel.ts` |
| `RTCPeerConnection` setup, offer/answer/ICE exchange | `hooks/use-speaking-room-call.ts` |
| Cloudflare Calls TURN integration + credential generation | `lib/webrtc-turn.ts`, `app/api/speaking-club/turn-credentials/route.ts` |
| Wired into the Phase 0 room screen | `app/speaking-club/room/[code]/page.tsx`, `components/speaking-club/remote-audio-sinks.tsx` |

Audio only, mesh topology (each participant opens one `RTCPeerConnection`
per *other* participant), so the 2-person and 3-person cases are the same
code path — there's nothing separate to "add" for the 3-person case, it
falls out of however many peers presence reports for that `room_code`.

## Setup before testing

1. `cp .env.example .env.local` and fill in at minimum:
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `JWT_SECRET`.
2. Run `sql/schema.sql` in the Supabase SQL editor if you haven't already
   (creates `speaking_rooms`/`speaking_shifts` and seeds `room-01..room-50`).
3. For the forced-TURN test, also set `CLOUDFLARE_TURN_KEY_ID` and
   `CLOUDFLARE_TURN_API_TOKEN` (see the comment block in `.env.example`).
   Without these, TURN is simply unavailable — direct P2P still works, but
   you can't verify the relay path.
4. `npm run dev`.

## Test 1 — 2-person call

Non-production builds accept a `?as=<name>` query param on the room page to
join as a specific test identity without needing two real logged-in
accounts (see the comment block at the top of
`app/speaking-club/room/[code]/page.tsx` — this override is compiled out in
`next build`/production and does nothing there).

1. Tab A: `http://localhost:3000/speaking-club/room/room-01?as=Karim`
2. Tab B (different browser or incognito window, so mic permission prompts
   independently): `http://localhost:3000/speaking-club/room/room-01?as=Nadia`
3. Grant microphone permission in both tabs.
4. **Expected:** both tabs show "Connecting…" briefly, then "Connected".
   Speak in Tab A — Tab B's tile for "Karim" should show the "Speaking"
   state and you should hear audio.

## Test 2 — 3-person call (§4.2 emergency case)

Same as Test 1, but open a third tab with a third `?as=` name in the same
room code:

```
?as=Karim
?as=Nadia
?as=Rafiq
```

**Expected:** all three tabs show two "Connected" peer tiles each (mesh —
everyone connects to everyone), the 3rd participant's tile renders with the
"Temporary partner" badge, and the grid switches to the 3-column layout.
Speak from each tab and confirm the other two both hear it.

## Test 3 — forced TURN relay

Append `&forceTurn=1` to force `iceTransportPolicy: "relay"` on every
`RTCPeerConnection`, so direct P2P is disabled and every media packet must
go through Cloudflare's TURN relay:

```
http://localhost:3000/speaking-club/room/room-01?as=Karim&forceTurn=1
http://localhost:3000/speaking-club/room/room-01?as=Nadia&forceTurn=1
```

**Expected:** still connects (via relay instead of direct P2P) — if it
doesn't, check `CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN` are set
correctly and that `GET /api/speaking-club/turn-credentials` (while signed
in) returns a `turnConfigured: true` response with real `urls`/`username`/
`credential` fields, not just the STUN-only fallback.

To confirm relay (not direct) was actually used, open DevTools →
`chrome://webrtc-internals` (Chrome) during the call and check the
selected candidate pair's type is `relay`, not `srflx`/`host`.

## Known gaps / next steps (explicitly out of Phase 2's scope)

- **No passkey/time-window gating yet** — that's Phase 3. Right now anyone
  signed in can open any `room_code` URL directly; Phase 3 adds the real
  "enter your passkey → land in your room, only during your shift window"
  flow in front of this same room page.
- **No session timer / auto-leave at shift end** — Phase 3 also owns
  showing the real countdown (Phase 0's design already has the UI for it;
  it was removed from the mock state and not yet reconnected to a real
  clock, since there's no real shift data to countdown to until Phase 3).
- **`remoteMuted` is a placeholder** (`false` always) — WebRTC doesn't
  expose "is the remote person's mic muted" natively; the peer must signal
  it explicitly. Wiring a small `{type: "mute-state"}` broadcast message
  through the existing signaling channel would be a quick follow-up, not
  required for the Phase 2 deliverable (which is about the connection
  itself, not this cosmetic detail).
- **Cloudflare's exact TURN REST response shape hasn't been verified
  against a live account** (see the comment in `lib/webrtc-turn.ts`) —
  double-check it once against a real `CLOUDFLARE_TURN_KEY_ID`.
- **TURN usage logging via `getStats()`** is Phase 7 (post-launch
  monitoring), not Phase 2.
