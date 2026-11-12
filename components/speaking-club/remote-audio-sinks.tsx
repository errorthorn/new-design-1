"use client";

// Plays every connected peer's remote audio stream. Deliberately has zero
// visual output — the room page's ParticipantTile already shows who's
// speaking/muted; this component's only job is getting the actual sound
// out of the speakers, one <audio> per peer since a mesh call (2 or 3
// people, plan §3.2/§4.2) has one MediaStream per remote peer, not one
// combined stream.
import { useEffect, useRef } from "react";
import type { PeerCallState } from "@/hooks/use-speaking-room-call";

export function RemoteAudioSinks({
  peers,
  deafened = false,
}: {
  peers: PeerCallState[];
  /** When true, mutes playback of every remote peer's audio locally —
   * the speaker/output toggle on the room page — without touching the
   * local mic or the underlying WebRTC connection. */
  deafened?: boolean;
}) {
  return (
    <div aria-hidden className="hidden">
      {peers.map((p) => (
        <PeerAudio key={p.peerId} stream={p.stream} muted={deafened} />
      ))}
    </div>
  );
}

function PeerAudio({ stream, muted }: { stream: MediaStream | null; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return <audio ref={ref} autoPlay playsInline muted={muted} />;
}
