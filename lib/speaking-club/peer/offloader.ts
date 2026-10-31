// lib/speaking-club/peer/offloader.ts
//
// The requester's side of partner offload: a small queue that sends the chunks of
// this device's speech to a helper partner while the call is running, and remembers
// which utterances came back as text. What was NOT answered (no helper, busy, partner
// left, timeout) is simply left for the post-call step to transcribe as usual.
import { PEER } from "@/lib/speaking-club/config";
import { cleanWhisperText } from "@/lib/speaking-club/audio/segmenter";

export type OffloadJob = { pos: number; audio: Int16Array; /** utterance indexes inside this chunk */ members: number[] };

export type OffloadHub = {
  hasFreeHelper(): boolean;
  request(audio: Int16Array): Promise<string | null>;
  onAvailability(cb: () => void): () => void;
};

const MAX_QUEUE = 8;

export class PeerOffloader {
  /** Text by chunk position (first utterance index), already cleaned. */
  readonly texts = new Map<number, string>();
  /** Utterance indexes whose text came back (even if it was "nothing worth keeping"). */
  readonly covered = new Set<number>();

  private readonly hub: OffloadHub;
  private queue: OffloadJob[] = [];
  private failures = 0;
  private stopped = false;
  private unsub: () => void;

  constructor(hub: OffloadHub) {
    this.hub = hub;
    this.unsub = hub.onAvailability(() => this.pump());
  }

  /** True while it is still worth handing chunks to this offloader. */
  get active(): boolean {
    return !this.stopped && this.failures < PEER.maxFailures;
  }

  submit(job: OffloadJob): void {
    if (!this.active) return;
    this.queue.push(job);
    // A partner that never answers must not make us hoard audio: the oldest wait for the post-call step instead.
    while (this.queue.length > MAX_QUEUE) this.queue.shift();
    this.pump();
  }

  private pump(): void {
    while (this.active && this.queue.length > 0 && this.hub.hasFreeHelper()) {
      const job = this.queue.shift()!;
      void this.hub.request(job.audio).then((text) => {
        if (this.stopped) return;
        if (text === null) {
          this.failures++;
        } else {
          this.failures = 0;
          const clean = cleanWhisperText(text, (job.audio.length / 16000) * 1000);
          if (clean) this.texts.set(job.pos, clean);
          job.members.forEach((m) => this.covered.add(m));
        }
        this.pump();
      });
    }
  }

  /** Ends the offloading and returns what the partner transcribed. Late answers are ignored. */
  stop(): { texts: Map<number, string>; covered: Set<number> } {
    this.stopped = true;
    this.unsub();
    this.queue = [];
    return { texts: this.texts, covered: this.covered };
  }
}
