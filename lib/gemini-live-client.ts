"use client";

type Role = "student" | "examiner";
type TranscriptEntry = { role: Role; text: string };

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function arrayBufferToBase64(buf: ArrayBufferLike): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private micStream: MediaStream | null = null;
  private micContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;

  private playbackContext: AudioContext | null = null;
  private playbackQueueTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  // Recording: both the student's mic and the AI examiner's voice are
  // mixed into one MediaStream (via a MediaStreamAudioDestinationNode in
  // the same AudioContext used for playback) so a teacher can later listen
  // to the whole conversation, not just read the transcript. This is tied
  // to the shared AudioContext, not the WebSocket, so it keeps recording
  // straight through a reconnect automatically.
  private recordingDestination: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordingMimeType = "audio/webm";

  private transcript: TranscriptEntry[] = [];

  // --- session resumption state ---
  private token = "";
  private model = "";
  private resumptionHandle: string | null = null;
  private everSetupComplete = false; // true once the very first setupComplete arrives
  private closingIntentionally = false; // set by close(), so onclose doesn't try to "recover" a deliberate stop
  private reconnecting = false;
  // Mic audio captured during the ~1-2s gap while swapping connections is
  // queued here instead of being dropped, then flushed once the new
  // connection's setupComplete arrives.
  private pendingAudioQueue: string[] = [];

  onOpen?: () => void;
  onError?: (message: string) => void;
  onClose?: () => void;
  onTranscriptUpdate?: (transcript: TranscriptEntry[]) => void;
  onReconnecting?: () => void; // optional: UI can show a subtle "reconnecting..." indicator
  onReconnected?: () => void;
  // Fires when the examiner calls the advance_part tool (see
  // gemini-session/route.ts) — i.e. right before it asks the first
  // question of Part 2 or Part 3. Part 1 has no event; it's the starting
  // state.
  onPartChange?: (part: 2 | 3) => void;
  // Fires whenever the examiner finishes a spoken turn (serverContent's
  // turnComplete flag). Used by the session page to know exactly when the
  // Part 2 cue-card reading has actually finished, so the real 1-minute
  // prep countdown starts at the right moment instead of at the moment
  // advance_part was called (which is before the cue card audio has even
  // played).
  onExaminerTurnComplete?: () => void;

  // True while the app is deliberately withholding the student's mic audio
  // from Gemini — used during the Part 2 preparation window so Gemini's
  // own voice-activity detection can't jump in over a stray sound and cut
  // the prep time short. The mic keeps recording as normal underneath
  // this (see startMic: the recording tap is on a separate node from the
  // one that sends to the WebSocket), only the outgoing stream to Gemini
  // is gated.
  private micSuppressed = false;

  setMicSuppressed(suppressed: boolean) {
    this.micSuppressed = suppressed;
  }

  /**
   * Sends a short text turn directly into the conversation, as if the app
   * itself spoke to the examiner. Used to hand control back to Gemini
   * right when the client-enforced prep countdown ends, instead of
   * relying on Gemini to track the minute itself.
   */
  sendTextTurn(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: "user", parts: [{ text }] }],
          turnComplete: true,
        },
      })
    );
  }

  async connect(token: string, model: string) {
    this.token = token;
    this.model = model;
    this.openSocket();
    await this.startMic();
  }

  /**
   * Opens (or re-opens) the WebSocket. If `this.resumptionHandle` is set,
   * the setup message includes it so the server resumes the same session
   * — same conversation history, same in-progress question — instead of
   * starting a brand new one.
   */
  private openSocket() {
    const isEphemeral = this.token.startsWith("auth_tokens/");
    const method = isEphemeral ? "BidiGenerateContentConstrained" : "BidiGenerateContent";
    const keyName = isEphemeral ? "access_token" : "key";

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.${method}?${keyName}=${encodeURIComponent(
      this.token
    )}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    const isResumeAttempt = !!this.resumptionHandle;
    let openedOk = false;

    ws.onopen = () => {
      openedOk = true;
      console.log(isResumeAttempt ? "🔄 WebSocket reconnected (resuming)" : "✅ WebSocket connected");

      const setup: any = {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      };
      if (this.resumptionHandle) {
        setup.sessionResumption = { handle: this.resumptionHandle };
      }
      ws.send(JSON.stringify({ setup }));
    };

    ws.onmessage = (evt) => this.handleMessage(evt, ws);

    ws.onerror = () => {
      // Browsers don't expose the HTTP status of a failed WS handshake, so
      // we can't reliably tell a 429/capacity error apart from any other
      // connection failure here — but if this is the very first connection
      // attempt and it never opened, "busy, try later" is a more honest
      // guess than a generic "something's wrong" message.
      if (!openedOk && !this.everSetupComplete) {
        this.onError?.("The server is busy right now, please try again shortly.");
      } else {
        this.onError?.("There was a connection problem with the Gemini WebSocket.");
      }
    };

    ws.onclose = () => {
      if (this.closingIntentionally) return;
      if (this.ws !== ws) return; // an already-superseded socket closing, ignore
      // If we get here without having been told to expect a goAway-driven
      // reconnect, treat it as a real disconnect.
      if (!this.reconnecting) {
        this.onClose?.();
      }
    };
  }

  /** Proactively swap to a fresh WebSocket using the last known resumption handle. */
  private reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.onReconnecting?.();

    const oldWs = this.ws;
    // Don't call close() on the app — just stop using this socket. Its
    // onclose is guarded by `this.ws !== ws` above so it won't fire onClose.
    try {
      oldWs?.close();
    } catch {
      // ignore
    }

    this.openSocket();
  }

  private async startMic() {
    console.log("🎤 Mic started");

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.micContext = new AudioContext({ sampleRate: 16000 });
    const source = this.micContext.createMediaStreamSource(this.micStream);
    this.processor = this.micContext.createScriptProcessor(4096, 1, 1);

    const silentGain = this.micContext.createGain();
    silentGain.gain.value = 0;
    source.connect(this.processor);
    this.processor.connect(silentGain);
    silentGain.connect(this.micContext.destination);

    // Set up the shared playback/recording context now (rather than lazily
    // on the AI's first reply) so the student's side of the conversation is
    // captured in the recording from the very first word, not just from
    // whenever the examiner first speaks.
    const recCtx = this.ensurePlaybackContext();
    const micTapSource = recCtx.createMediaStreamSource(this.micStream);
    if (this.recordingDestination) {
      micTapSource.connect(this.recordingDestination);
    }

    this.processor.onaudioprocess = (e) => {
      // Prep-window gate: drop entirely rather than queue. This is a
      // deliberate silence, not a network gap, so there's nothing to
      // flush once it lifts — sending stale audio after unsuppressing
      // would just confuse the turn that's about to start.
      if (this.micSuppressed) return;

      const input = e.inputBuffer.getChannelData(0);
      const pcm16 = floatTo16BitPCM(input);
      const base64 = arrayBufferToBase64(pcm16.buffer);

      // While a reconnect is in flight, queue instead of dropping — this
      // is the mic-audio-gap decision from the handover: buffer locally
      // rather than lose whatever the student says during the swap.
      if (this.reconnecting || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.pendingAudioQueue.push(base64);
        // Cap the queue so a long stall (network dead, not just a brief
        // reconnect) doesn't grow this unboundedly — ~30s of audio at
        // ~4096 samples/16kHz per chunk is roughly 125 chunks.
        if (this.pendingAudioQueue.length > 150) {
          this.pendingAudioQueue.shift();
        }
        return;
      }

      this.sendAudioChunk(base64);
    };
  }

  private sendAudioChunk(base64: string) {
    this.ws?.send(
      JSON.stringify({
        realtimeInput: { audio: { data: base64, mimeType: "audio/pcm;rate=16000" } },
      })
    );
  }

  private flushPendingAudio() {
    if (!this.pendingAudioQueue.length) return;
    console.log(`▶️ Flushing ${this.pendingAudioQueue.length} buffered audio chunks after reconnect`);
    const queue = this.pendingAudioQueue;
    this.pendingAudioQueue = [];
    for (const chunk of queue) {
      this.sendAudioChunk(chunk);
    }
  }

  private async handleMessage(evt: MessageEvent, sourceWs: WebSocket) {
    // Ignore messages from a socket we've already moved on from.
    if (this.ws !== sourceWs) return;

    let text: string;
    if (evt.data instanceof Blob) {
      text = await evt.data.text();
    } else {
      text = evt.data;
    }

    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (msg.setupComplete) {
      const wasReconnect = this.reconnecting;
      this.reconnecting = false;
      this.everSetupComplete = true;
      this.flushPendingAudio();
      if (wasReconnect) {
        this.onReconnected?.();
      } else {
        this.onOpen?.();
      }
      return;
    }

    // Server telling us it's about to close this connection — reconnect
    // proactively using the last saved handle rather than waiting for a
    // hard failure.
    if (msg.goAway) {
      console.log("⚠️ goAway received, timeLeft:", msg.goAway.timeLeft);
      this.reconnect();
      return;
    }

    if (msg.sessionResumptionUpdate) {
      const update = msg.sessionResumptionUpdate;
      if (update.resumable && update.newHandle) {
        this.resumptionHandle = update.newHandle;
      }
      return;
    }

    // The examiner calling advance_part to signal a Part 1→2 or 2→3
    // transition (see the tool declaration in gemini-session/route.ts).
    // Gemini expects a toolResponse acknowledging every functionCall
    // before it will continue the conversation.
    if (msg.toolCall) {
      this.handleToolCall(msg.toolCall);
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.interrupted) {
      this.stopPlayback();
    }

    if (sc.inputTranscription?.text) {
      this.appendTranscript("student", sc.inputTranscription.text);
    }
    if (sc.outputTranscription?.text) {
      this.appendTranscript("examiner", sc.outputTranscription.text);
    }

    if (sc.modelTurn?.parts) {
      for (const part of sc.modelTurn.parts) {
        if (part.inlineData?.data) {
          this.playChunk(part.inlineData.data);
        }
      }
    }

    if (sc.turnComplete) {
      this.onExaminerTurnComplete?.();
    }
  }

  private appendTranscript(role: Role, text: string) {
    const last = this.transcript[this.transcript.length - 1];
    if (last && last.role === role) {
      last.text += text;
    } else {
      this.transcript.push({ role, text });
    }
    this.onTranscriptUpdate?.([...this.transcript]);
  }

  // The examiner calling advance_part to signal a Part 1→2 or 2→3
  // transition (see the tool declaration in gemini-session/route.ts).
  // Gemini expects a toolResponse acknowledging every functionCall before
  // it will continue the conversation, regardless of whether the part
  // number it sent was one we recognize.
  private handleToolCall(toolCall: any) {
    const calls = toolCall.functionCalls ?? [];
    const responses: any[] = [];
    for (const call of calls) {
      if (call.name === "advance_part") {
        const part = Number(call.args?.part);
        if (part === 2 || part === 3) {
          this.onPartChange?.(part);
        }
      }
      responses.push({ id: call.id, name: call.name, response: { result: "ok" } });
    }
    if (responses.length && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
    }
  }

  private ensurePlaybackContext() {
    if (!this.playbackContext) {
      this.playbackContext = new AudioContext({ sampleRate: 24000 });
      this.playbackQueueTime = this.playbackContext.currentTime;
      this.startRecording();
    }
    return this.playbackContext;
  }

  private startRecording() {
    if (!this.playbackContext || this.mediaRecorder) return;

    this.recordingDestination = this.playbackContext.createMediaStreamDestination();

    // Prefer opus-in-webm; fall back to whatever the browser supports so a
    // missing codec doesn't crash the whole test, it just skips recording.
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const supported = candidates.find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)
    );

    if (typeof MediaRecorder === "undefined" || !supported) {
      console.warn("MediaRecorder not supported in this browser — recording disabled.");
      return;
    }

    this.recordingMimeType = supported;
    try {
      this.mediaRecorder = new MediaRecorder(this.recordingDestination.stream, {
        mimeType: supported,
      });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
      };
      // 1s timeslice so we get data progressively instead of one huge chunk
      // only at the end (which would be lost if the tab crashed mid-test).
      this.mediaRecorder.start(1000);
    } catch (err) {
      console.warn("Could not start MediaRecorder — recording disabled:", err);
      this.mediaRecorder = null;
    }
  }

  /**
   * Stops the recorder and resolves with the merged mic+examiner audio as a
   * single Blob (or null if recording wasn't available in this browser, or
   * nothing was ever captured). Call this BEFORE close(), since close() tears
   * down the audio contexts the recorder depends on.
   */
  async stopRecording(): Promise<Blob | null> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === "inactive") {
      return this.recordedChunks.length
        ? new Blob(this.recordedChunks, { type: this.recordingMimeType })
        : null;
    }
    return new Promise((resolve) => {
      recorder.onstop = () => {
        resolve(
          this.recordedChunks.length
            ? new Blob(this.recordedChunks, { type: this.recordingMimeType })
            : null
        );
      };
      try {
        recorder.stop();
      } catch {
        resolve(
          this.recordedChunks.length
            ? new Blob(this.recordedChunks, { type: this.recordingMimeType })
            : null
        );
      }
    });
  }

  private playChunk(base64: string) {
    const ctx = this.ensurePlaybackContext();
    const pcmBuffer = base64ToArrayBuffer(base64);
    const int16 = new Int16Array(pcmBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    if (this.recordingDestination) {
      source.connect(this.recordingDestination);
    }

    const startAt = Math.max(ctx.currentTime, this.playbackQueueTime);
    source.start(startAt);
    this.playbackQueueTime = startAt + audioBuffer.duration;

    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
    };
  }

  private stopPlayback() {
    this.activeSources.forEach((s) => {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    });
    this.activeSources = [];
    if (this.playbackContext) {
      this.playbackQueueTime = this.playbackContext.currentTime;
    }
  }

  getTranscriptText(): string {
    return this.transcript
      .map((t) => `${t.role === "student" ? "Student" : "Examiner"}: ${t.text}`)
      .join("\n");
  }

  close() {
    this.closingIntentionally = true;
    this.stopPlayback();
    // Fallback only — callers should normally await stopRecording() first
    // to get the Blob before contexts are torn down here.
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch {
        // already stopped
      }
    }
    this.processor?.disconnect();
    this.micContext?.close();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.playbackContext?.close();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}
