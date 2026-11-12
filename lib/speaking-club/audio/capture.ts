// lib/speaking-club/audio/capture.ts
//
// In-browser, transcript-only speech capture for Speaking Club AI feedback.
//
// DURING the call this module only LISTENS (cheap): it takes the call's own,
// already-open mic track, cuts the student's speech into utterances (silence is
// dropped) and keeps them — in memory and in the device's own IndexedDB, as
// 16-bit 16 kHz audio. No model runs and nothing is transcribed while the call
// is live, so the conversation is exactly as smooth as without AI feedback.
// AFTER the call, lib/speaking-club/post-call/engine.ts turns those utterances into text
// with a small Whisper model (Web Worker, on this device) and submits the TEXT
// like any other transcript. With Whisper the audio never leaves the device; with BYOK (default)
// it goes only to Google with the student's own key, never to our server. It is deleted as
// soon as the text is submitted.
//
//   call mic track ──► AudioContext ──► Resampler(16 kHz) ──► SpeechSegmenter
//                                                                   │ utterances
//                          memory + IndexedDB  ◄────────────────────┘
//
// Respecting the call's mute button: we read the SAME track object the call
// uses (wrapped in a new MediaStream, never cloned), so while the student is
// muted the track delivers silence and nothing is captured.
//
// Everything here is best-effort and must never throw into, block, or slow
// down the live call.
import { Resampler, SpeechSegmenter, TARGET_SAMPLE_RATE, mergeSegments, type MergeItem } from "@/lib/speaking-club/audio/segmenter";
import { LIMITS, PEER, cloudTranscribeEnabled, SLOW_DEVICE_CHUNK_SECONDS, liveChunkSeconds, peerOffloadEnabled, whisperPoolEnabled, whisperPoolMax, whisperRemoteHost, whisperWebGpuEnabled } from "@/lib/speaking-club/config";
import { HelperPool } from "@/lib/speaking-club/transcription/helper-pool";
import { desiredHelpers } from "@/lib/speaking-club/transcription/pool-policy";
import { PeerAsrHub } from "@/lib/speaking-club/peer/peer-asr";
import { PeerOffloader } from "@/lib/speaking-club/peer/offloader";
import type { ExternalResults } from "@/lib/speaking-club/post-call/engine";
import { deviceCanCaptureAudio, deviceCanRunWhisper, deviceHints, liveTranscriptionEnabled } from "@/lib/speaking-club/device";
import { deleteSegment, floatToInt16, saveSegment, saveSession, type SessionMeta } from "@/lib/speaking-club/storage/segment-store";
import { ChunkTranscriber } from "@/lib/speaking-club/transcription/chunk-transcriber";
import { createWhisperWorker, pickWhisperModel } from "@/lib/speaking-club/transcription/model";

export type CaptureStatus = "starting" | "capturing" | "error" | "too-weak";

export type CaptureState = {
  status: CaptureStatus;
  /** Seconds of the student's speech captured so far (silence excluded). */
  seconds: number;
  segments: number;
  error?: string;
};

// ---------------------------------------------------------------------------
// The in-call capture
// ---------------------------------------------------------------------------

// Cap on the speech kept IN MEMORY on devices that do not transcribe live: 70 min
// of actual talking is ~135 MB of 16-bit audio (a student talking for 50 of a 60
// minute slot is ~96 MB). Beyond that the OLDEST utterances are dropped. With live
// transcription the raw utterances are not kept in memory at all (the transcriber's
// own results/queue and the IndexedDB mirror hold them), so no cap applies.

let activeCaptures = 0;
/** True while any call in this tab is being captured (the post-call engine waits for it). */
export function isAnyCaptureActive(): boolean {
  return activeCaptures > 0;
}

/** How long without a live mic track before the student is told capture is not working. */
const NO_TRACK_ERROR_MS = 20_000;

export type CaptureResult = {
  meta: SessionMeta;
  segments: Int16Array[];
  /** Utterance index of each entry of `segments` (set only when `external` covers some utterances). */
  positions?: number[];
  /** Text the partner's device already produced during the call (partner offload), or null. */
  external: ExternalResults | null;
  /** Background transcriber that has been working during the call (null on devices that don't do live transcription). */
  live: ChunkTranscriber | null;
};

type CaptureSessionInfo = Pick<SessionMeta, "shiftId" | "studentUsername" | "topicTitle" | "cueCardQuestions">;

export class SpeakingAudioCapture {
  private readonly getTrack: () => MediaStreamTrack | null;
  private readonly getInfo: () => CaptureSessionInfo | null;
  private readonly getPrior: () => string;
  private readonly onState: (state: CaptureState) => void;

  private readonly sessionId: string;
  private readonly createdAt = Date.now();
  private state: CaptureState = { status: "starting", seconds: 0, segments: 0 };
  private entries: { idx: number; data: Int16Array }[] = []; // only used when NOT transcribing live
  private segmentTotal = 0;
  private nextIdx = 0;
  private seconds = 0;
  private started = false;
  private stopped = false;
  private disposed = false;
  private counted = false;

  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioNode | null = null;
  private sinkNode: GainNode | null = null;
  private currentTrack: MediaStreamTrack | null = null;
  private noTrackSince = 0;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unlockHandler: (() => void) | null = null;
  private resampler: Resampler | null = null;
  private segmenter = new SpeechSegmenter();

  // Live transcription: utterances are merged into ~25 s chunks and handed to a
  // background transcriber as the student talks.
  private live: ChunkTranscriber | null = null;
  // Partner offload (opt-in): a strong device HELPS its partner, a weak one ASKS for help.
  // Extra model copies that share the chunks that pile up while the student is silent (opt-in).
  private pool: HelperPool | null = null;
  private studentSpeaking = false;
  private hub: PeerAsrHub | null = null;
  private offloader: PeerOffloader | null = null;
  private liveBuf: MergeItem[] = [];
  private liveBufSamples = 0;
  private liveBufSince = 0;

  constructor(opts: {
    getTrack: () => MediaStreamTrack | null;
    /** Who/what this session belongs to; null until a real shift is known. */
    getInfo: () => CaptureSessionInfo | null;
    /** Text another engine (Web Speech) already captured earlier in this call. */
    getPrior: () => string;
    onState: (state: CaptureState) => void;
  }) {
    this.getTrack = opts.getTrack;
    this.getInfo = opts.getInfo;
    this.getPrior = opts.getPrior;
    this.onState = opts.onState;
    this.sessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private setState(patch: Partial<CaptureState>) {
    this.state = { ...this.state, ...patch, seconds: Math.round(this.seconds), segments: this.segmentTotal };
    try {
      this.onState(this.state);
    } catch {
      // UI callbacks must never break capture
    }
  }

  private buildMeta(status: SessionMeta["status"]): SessionMeta | null {
    const info = this.getInfo();
    if (!info) return null;
    return {
      sessionId: this.sessionId,
      ...info,
      priorTranscript: this.getPrior(),
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      status,
      attempts: 0,
      segmentCount: this.segmentTotal,
    };
  }

  /** Starts listening to the call's mic. Idempotent; never throws. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;

    // A device that cannot run the model at all can still COLLECT speech when the cloud
    // or a partner's device may transcribe it later.
    const canModel = deviceCanRunWhisper();
    const canCollect = canModel || ((cloudTranscribeEnabled() || peerOffloadEnabled()) && deviceCanCaptureAudio());
    if (!canCollect) {
      this.setState({ status: "too-weak", error: "device-unsupported" });
      return;
    }
    try {
      activeCaptures++;
      this.counted = true;
      if (canModel && liveTranscriptionEnabled()) {
        this.live = new ChunkTranscriber({
          createWorker: createWhisperWorker,
          modelId: pickWhisperModel(),
          remoteHost: whisperRemoteHost(),
          webgpu: whisperWebGpuEnabled(),
        });
        this.live.startLive(); // the model only loads when the first chunk is ready
        this.startHelperPool(this.live);
      }
      this.startPeerOffload();
      await this.attachAudio();
      this.watchTimer = setInterval(() => this.watchTrack(), LIMITS.captureTrackWatchMs);
      this.heartbeatTimer = setInterval(() => {
        const meta = this.buildMeta("capturing");
        if (meta) void saveSession(meta);
      }, LIMITS.captureHeartbeatMs);
      const meta = this.buildMeta("capturing");
      if (meta) void saveSession(meta);
      this.setState({ status: "capturing" });
    } catch (err) {
      this.setState({ status: "error", error: err instanceof Error ? err.message : "start-failed" });
    }
  }

  // ---- audio capture ------------------------------------------------------

  private async attachAudio() {
    const track = this.getTrack();
    if (!track || track.readyState !== "live") return; // watchTrack() retries
    this.currentTrack = track;

    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) throw new Error("no-audio-context");
    if (!this.audioCtx) {
      // Default sample rate on purpose: forcing 16 kHz makes Firefox/Safari
      // refuse to connect a MediaStream source. We resample ourselves.
      this.audioCtx = new Ctor();
      this.resampler = new Resampler(this.audioCtx.sampleRate, TARGET_SAMPLE_RATE);
    }
    const audioCtx = this.audioCtx;
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
    if (!this.unlockHandler) {
      // iOS Safari starts (and after a phone call / app switch, "interrupts")
      // AudioContexts until a user gesture: resume on any tap/key and on state
      // changes so capture can't silently stay dead.
      this.unlockHandler = () => {
        const st = this.audioCtx?.state as string | undefined;
        if (st === "suspended" || st === "interrupted") void this.audioCtx?.resume().catch(() => {});
      };
      for (const ev of ["pointerdown", "touchend", "keydown"]) {
        window.addEventListener(ev, this.unlockHandler, { passive: true });
      }
      document.addEventListener("visibilitychange", this.unlockHandler);
      audioCtx.onstatechange = this.unlockHandler;
    }

    this.detachSource();
    // Same track the call uses, wrapped (not cloned) so call-mute silences us too.
    this.sourceNode = audioCtx.createMediaStreamSource(new MediaStream([track]));

    if (!this.captureNode) {
      this.sinkNode = audioCtx.createGain();
      this.sinkNode.gain.value = 0; // keeps the graph pulled without any audible output
      this.sinkNode.connect(audioCtx.destination);

      let node: AudioNode | null = null;
      if (typeof AudioWorkletNode !== "undefined" && audioCtx.audioWorklet) {
        try {
          const code = `
            class LcCapture extends AudioWorkletProcessor {
              constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
              process(inputs) {
                const ch = inputs[0] && inputs[0][0];
                if (ch) {
                  for (let i = 0; i < ch.length; i++) {
                    this.buf[this.n++] = ch[i];
                    if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
                  }
                }
                return true;
              }
            }
            registerProcessor("lc-capture", LcCapture);`;
          const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
          await audioCtx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          const wn = new AudioWorkletNode(audioCtx, "lc-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
          wn.port.onmessage = (e: MessageEvent<Float32Array>) => this.onAudio(e.data);
          node = wn;
        } catch {
          node = null; // e.g. CSP or old Safari — use the ScriptProcessor below
        }
      }
      if (!node) {
        // Deprecated but universally available fallback.
        const sp = audioCtx.createScriptProcessor(4096, 1, 1);
        sp.onaudioprocess = (e) => this.onAudio(new Float32Array(e.inputBuffer.getChannelData(0)));
        node = sp;
      }
      node.connect(this.sinkNode);
      this.captureNode = node;
    }

    this.sourceNode.connect(this.captureNode!);
  }

  private detachSource() {
    try {
      this.sourceNode?.disconnect();
    } catch {
      // already disconnected
    }
    this.sourceNode = null;
  }

  /** The call may replace its mic track (reconnect, device change): follow it. */
  private watchTrack() {
    if (this.disposed || this.stopped) return;
    // A student who talks rarely must not leave speech waiting in the buffer for long.
    if (this.liveBuf.length > 0 && Date.now() - this.liveBufSince >= 30_000) this.flushLiveBuf();
    const st = this.audioCtx?.state as string | undefined;
    if (st === "suspended" || st === "interrupted") void this.audioCtx?.resume().catch(() => {});
    const latest = this.getTrack();
    if (!latest || latest.readyState !== "live") {
      // The call never handed us a live mic track: say so instead of silently capturing nothing.
      if (!this.noTrackSince) this.noTrackSince = Date.now();
      if (!this.currentTrack && Date.now() - this.noTrackSince >= NO_TRACK_ERROR_MS && this.state.status !== "error") {
        this.setState({ status: "error", error: "no-mic-track" });
      }
      return;
    }
    this.noTrackSince = 0;
    if (this.state.status === "error" && this.state.error === "no-mic-track") {
      this.setState({ status: "capturing", error: undefined }); // the track arrived after all
    }
    if (latest !== this.currentTrack) {
      void this.attachAudio().catch(() => {});
    }
  }

  private onAudio(chunk: Float32Array) {
    if (this.disposed || this.stopped || !this.resampler) return;
    try {
      const pcm = this.resampler.push(chunk);
      if (pcm.length === 0) return;
      for (const seg of this.segmenter.push(pcm)) this.addSegment(seg.samples, seg.durationMs);
      // When the student stops talking, the partner is talking: a good moment to put helpers to work.
      const speaking = this.segmenter.isSpeaking;
      if (speaking !== this.studentSpeaking) {
        this.studentSpeaking = speaking;
        if (!speaking) this.pool?.kick();
      }
    } catch {
      // never let audio processing throw into the audio thread callback
    }
  }

  private addSegment(samples: Float32Array, durationMs: number) {
    const data = floatToInt16(samples);
    const idx = this.nextIdx++;
    this.segmentTotal++;
    if (!this.live) this.entries.push({ idx, data });
    this.seconds += durationMs / 1000;
    void saveSegment(this.sessionId, idx, data); // mirror to IndexedDB (best-effort)
    this.feedLive(idx, data);

    // Memory cap: drop the oldest utterances once past ~30 min of speech.
    while (this.seconds > LIMITS.maxSpeechSecondsInMemory && this.entries.length > 1) {
      const old = this.entries.shift()!;
      this.seconds -= old.data.length / TARGET_SAMPLE_RATE;
      void deleteSegment(this.sessionId, old.idx);
    }
    this.setState({});
  }

  // ---- live transcription feed ---------------------------------------------

  private startHelperPool(live: ChunkTranscriber) {
    if (!whisperPoolEnabled()) return;
    try {
      const pool = new HelperPool(live, {
        create: () =>
          new ChunkTranscriber({
            createWorker: createWhisperWorker,
            modelId: pickWhisperModel(),
            remoteHost: whisperRemoteHost(),
            webgpu: whisperWebGpuEnabled(),
          }),
        desired: () =>
          desiredHelpers({
            phase: "live",
            studentSpeaking: this.studentSpeaking,
            waitingChunks: live.queueLength,
            maxTotal: whisperPoolMax(),
            ...deviceHints(),
          }),
      });
      // The post-call step waits for the chunks the helpers are still working on (stopLive).
      live.helperDrain = () => pool.finish();
      pool.start();
      this.pool = pool;
    } catch {
      // helpers are a bonus: never let them break the capture
    }
  }

  private startPeerOffload() {
    if (!peerOffloadEnabled()) return;
    try {
      const hub = new PeerAsrHub();
      hub.start();
      this.hub = hub;
      if (this.live) {
        // Strong device: offer to transcribe for the partner, but only while it has headroom
        // and its own model is already loaded (never start a download mid-call for someone else).
        const live = this.live;
        hub.setHelper({
          canAccept: () => !this.stopped && live.isLoaded && !live.throttled && live.queuedSeconds < PEER.helperMaxBacklogSec,
          transcribe: (audio) => live.transcribeExternal(audio),
        });
      } else {
        // Weak device: ask a strong partner to transcribe, while the call runs.
        this.offloader = new PeerOffloader(hub);
      }
    } catch {
      // partner offload is a bonus: never let it break the capture
    }
  }

  private feedLive(pos: number, data: Int16Array) {
    if (!this.live && !this.offloader) return;
    if (this.liveBuf.length === 0) this.liveBufSince = Date.now();
    this.liveBuf.push({ pos, data });
    this.liveBufSamples += data.length;
    // Small chunks keep the after-call tail short; a device that is falling behind uses bigger ones (less total work).
    const chunkSec = this.live?.throttled ? Math.max(liveChunkSeconds(), SLOW_DEVICE_CHUNK_SECONDS) : liveChunkSeconds();
    if (this.liveBufSamples >= chunkSec * TARGET_SAMPLE_RATE) this.flushLiveBuf();
  }

  private flushLiveBuf() {
    if ((!this.live && !this.offloader) || this.liveBuf.length === 0) return;
    for (const job of mergeSegments(this.liveBuf)) {
      if (this.live) this.live.enqueue(job);
      else this.offloader?.submit({ pos: job.pos, audio: job.audio, members: job.members ?? [job.pos] });
    }
    this.liveBuf = [];
    this.liveBufSamples = 0;
    this.pool?.kick();
  }

  // ---- finishing ----------------------------------------------------------

  /**
   * Ends the capture (call over): closes the open utterance, releases the audio
   * graph and returns everything captured, to be handed to the post-call engine.
   * Returns null if capture never started or no shift is known.
   */
  stop(): CaptureResult | null {
    if (this.stopped) return null;
    this.stopped = true;
    try {
      const last = this.segmenter.flush();
      if (last) this.addSegment(last.samples, last.durationMs);
    } catch {
      // ignore
    }
    this.flushLiveBuf(); // whatever was still buffered goes to the queue (the post-call step finishes it)
    const meta = this.started ? this.buildMeta("ready") : null;
    if (meta) void saveSession(meta); // the engine re-saves with its own bookkeeping later
    // What the partner already transcribed is not transcribed again.
    const offloaded = this.offloader?.stop() ?? null;
    this.stopPeer();
    this.pool?.stopTaking(); // chunks helpers already took still finish; the post-call step waits for them (stopLive)
    this.pool = null;
    const covered = offloaded?.covered ?? new Set<number>();
    const rest = covered.size > 0 ? this.entries.filter((e) => !covered.has(e.idx)) : this.entries;
    const segments = rest.map((e) => e.data);
    const positions = covered.size > 0 ? rest.map((e) => e.idx) : undefined;
    const external = offloaded && offloaded.texts.size + covered.size > 0 ? offloaded : null;
    const live = this.live;
    this.live = null; // ownership moves to the post-call engine
    this.releaseAudio();
    if (!meta) {
      live?.dispose();
      return null;
    }
    return { meta, segments, positions, external, live };
  }

  private stopPeer() {
    try {
      this.hub?.setHelper(null);
      this.hub?.dispose();
    } catch {
      // ignore
    }
    this.hub = null;
    this.offloader = null;
  }

  /** Stops listening WITHOUT handing anything over (page left mid-call, etc.). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.offloader?.stop();
    this.stopPeer();
    this.pool?.dispose();
    this.pool = null;
    this.live?.dispose();
    this.live = null;
    this.releaseAudio();
  }

  private releaseAudio() {
    if (this.watchTimer) clearInterval(this.watchTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.watchTimer = null;
    this.heartbeatTimer = null;
    if (this.unlockHandler) {
      for (const ev of ["pointerdown", "touchend", "keydown"]) window.removeEventListener(ev, this.unlockHandler);
      document.removeEventListener("visibilitychange", this.unlockHandler);
      this.unlockHandler = null;
    }
    this.detachSource();
    try {
      this.captureNode?.disconnect();
      this.sinkNode?.disconnect();
    } catch {
      // ignore
    }
    try {
      void this.audioCtx?.close();
    } catch {
      // ignore
    }
    this.audioCtx = null;
    this.captureNode = null;
    this.sinkNode = null;
    if (this.counted) {
      this.counted = false;
      activeCaptures = Math.max(0, activeCaptures - 1);
    }
  }
}
