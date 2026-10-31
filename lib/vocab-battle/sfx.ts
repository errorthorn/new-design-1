"use client";

// lib/vocab-battle/sfx.ts
//
// Tiny synthesized sound effects for Vocab Battle — Web Audio oscillators,
// so there are no audio files to ship or load. Sound is a per-device
// preference remembered in localStorage.
//
// Default: ON in solo, OFF in the Speaking Club (`defaultOn: false`). Inside
// a call the game shares the room with a live microphone, and a beep from
// the speaker would leak into it and echo to the partner; a student can
// still switch it on.

import { useCallback, useEffect, useRef, useState } from "react";

export type SfxName = "tick" | "go" | "correct" | "wrong" | "powerup" | "win" | "lose" | "draw" | "pop";

const STORAGE_KEY = "vb-sfx";

type Note = { freq: number; at: number; dur: number; type?: OscillatorType; gain?: number };

const SOUNDS: Record<SfxName, Note[]> = {
  tick: [{ freq: 880, at: 0, dur: 0.04, gain: 0.05 }],
  go: [{ freq: 1175, at: 0, dur: 0.22, gain: 0.08 }],
  correct: [
    { freq: 660, at: 0, dur: 0.09 },
    { freq: 990, at: 0.09, dur: 0.14 },
  ],
  wrong: [
    { freq: 220, at: 0, dur: 0.12, type: "sawtooth", gain: 0.06 },
    { freq: 165, at: 0.11, dur: 0.2, type: "sawtooth", gain: 0.06 },
  ],
  powerup: [
    { freq: 523, at: 0, dur: 0.09 },
    { freq: 659, at: 0.09, dur: 0.09 },
    { freq: 784, at: 0.18, dur: 0.16 },
  ],
  win: [
    { freq: 523, at: 0, dur: 0.12 },
    { freq: 659, at: 0.12, dur: 0.12 },
    { freq: 784, at: 0.24, dur: 0.12 },
    { freq: 1047, at: 0.36, dur: 0.32 },
  ],
  // Result screen when you lose / draw — soft and short, never harsh.
  lose: [
    { freq: 392, at: 0, dur: 0.14, gain: 0.06 },
    { freq: 330, at: 0.14, dur: 0.14, gain: 0.06 },
    { freq: 262, at: 0.28, dur: 0.28, gain: 0.06 },
  ],
  draw: [
    { freq: 523, at: 0, dur: 0.12, gain: 0.06 },
    { freq: 523, at: 0.16, dur: 0.18, gain: 0.06 },
  ],
  // Very quiet blip when the opponent sends an emoji reaction.
  pop: [{ freq: 1320, at: 0, dur: 0.05, gain: 0.035 }],
};

// Reads the CURRENT saved preference (falls back to the default). Several
// components each call useSfx() with their own state, so the value captured
// at mount can be stale after the player flips the speaker toggle mid-game.
function isSoundOn(defaultOn: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "on") return true;
    if (stored === "off") return false;
  } catch {
    // Storage blocked — use the default.
  }
  return defaultOn;
}

export function useSfx(defaultOn: boolean) {
  const [enabled, setEnabled] = useState(defaultOn);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "on") setEnabled(true);
      else if (stored === "off") setEnabled(false);
    } catch {
      // Storage blocked — keep the default.
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const play = useCallback(
    (name: SfxName) => {
      if (!isSoundOn(defaultOn)) return;
      try {
        // Created lazily, on a sound the player's own click/tap led to —
        // browsers only allow audio to start after a user gesture.
        const Ctor: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = (ctxRef.current ??= new Ctor());
        if (ctx.state === "suspended") ctx.resume().catch(() => {});

        const start = ctx.currentTime;
        for (const n of SOUNDS[name]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = n.type ?? "sine";
          osc.frequency.value = n.freq;
          const peak = n.gain ?? 0.09;
          gain.gain.setValueAtTime(0.0001, start + n.at);
          gain.gain.exponentialRampToValueAtTime(peak, start + n.at + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + n.at + n.dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(start + n.at);
          osc.stop(start + n.at + n.dur + 0.02);
        }
      } catch {
        // Sound is a nicety — never let it break a round.
      }
    },
    [defaultOn]
  );

  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  return { enabled, toggle, play };
}
