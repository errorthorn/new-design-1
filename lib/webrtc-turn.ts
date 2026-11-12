// lib/webrtc-turn.ts
//
// Server-only helper for Phase 2 (§3.3 of SPEAKING-CLUB-WEBRTC-PLAN.md):
// generates short-lived Cloudflare Calls TURN credentials so the browser
// never sees the long-lived Cloudflare API token, only a temporary
// username/credential pair scoped to one call.
//
// Cloudflare Calls TURN REST API (docs: developers.cloudflare.com/calls/turn):
//   POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers
//   Authorization: Bearer {TURN_API_TOKEN}
//   body: { "ttl": <seconds> }
// Response shape: { iceServers: { urls: string[], username: string, credential: string } }
// (Cloudflare has changed response shape before across API versions — if
// this route starts returning 4xx/5xx after a Cloudflare change, check
// their current docs and adjust parseCloudflareResponse() below; nothing
// else in this file should need to change.)
//
// This sandbox has no network access to rtc.live.cloudflare.com, so this
// call has NOT been exercised against the real Cloudflare API — verify it
// once with real CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_API_TOKEN values
// before relying on the forced-TURN test case (Phase 2 deliverable, plan
// §9). See PHASE2-TESTING.md.

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

const CLOUDFLARE_TURN_ENDPOINT = (turnKeyId: string) =>
  `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`;

// Always-available fallback so local dev / direct-P2P-only testing works
// even with zero Cloudflare setup. STUN is free and browser-native (plan
// §7) — it just can't relay traffic like TURN can, so the "forced TURN
// relay" Phase 2 test case needs the real Cloudflare credentials below.
const PUBLIC_STUN_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function parseCloudflareResponse(json: any): IceServer[] {
  // Cloudflare's documented shape wraps a single object; normalize to an
  // array either way so callers don't care which shape came back.
  const raw = json?.iceServers;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Returns the ICE server list to hand to `new RTCPeerConnection({ iceServers })`.
 * Falls back to STUN-only (no relay) if Cloudflare env vars aren't configured,
 * so the app degrades instead of crashing — same pattern as the rest of this
 * codebase's optional integrations (see .env.example).
 */
export async function getIceServers(ttlSeconds = 3600): Promise<{
  iceServers: IceServer[];
  turnConfigured: boolean;
}> {
  const turnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

  if (!turnKeyId || !apiToken) {
    return { iceServers: PUBLIC_STUN_SERVERS, turnConfigured: false };
  }

  const res = await fetch(CLOUDFLARE_TURN_ENDPOINT(turnKeyId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl: ttlSeconds }),
    // Never cache credentials — they're short-lived and per-call.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cloudflare TURN credential request failed (${res.status}): ${body}`);
  }

  const json = await res.json();
  const turnServers = parseCloudflareResponse(json);

  return {
    // STUN first (cheap, tried first by the browser), Cloudflare TURN as
    // the relay fallback — this ordering doesn't affect the "forced TURN"
    // test case, since that's controlled by iceTransportPolicy: "relay"
    // on the RTCPeerConnection itself (see hooks/use-speaking-room-call.ts),
    // not by server ordering.
    iceServers: [...PUBLIC_STUN_SERVERS, ...turnServers],
    turnConfigured: true,
  };
}
