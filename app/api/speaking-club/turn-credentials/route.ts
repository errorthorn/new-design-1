// app/api/speaking-club/turn-credentials/route.ts
//
// Phase 2 deliverable (plan §3.3, §9): the browser calls this to get the
// ICE server list (STUN + short-lived Cloudflare TURN credentials) for a
// call. Kept behind login (requireUser) so the Cloudflare TURN token itself
// never reaches the client — only a scoped, temporary username/credential
// pair does, and only to a signed-in user.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getIceServers } from "@/lib/webrtc-turn";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    const { iceServers, turnConfigured } = await getIceServers();
    return NextResponse.json({ iceServers, turnConfigured });
  } catch (err) {
    console.error("[speaking-club/turn-credentials] Cloudflare TURN request failed:", err);
    // Degrade instead of blocking the call entirely — direct P2P can still
    // work without TURN for students whose NAT allows it (plan §7 estimates
    // most students, on home wifi, won't need TURN at all).
    return NextResponse.json(
      {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        turnConfigured: false,
        warning: "TURN relay unavailable — only direct P2P connections will work right now.",
      },
      { status: 200 }
    );
  }
}
