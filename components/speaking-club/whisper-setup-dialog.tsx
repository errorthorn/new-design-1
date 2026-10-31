"use client";

// One-time "AI feedback setup" pop-up for Speaking Club (dashboard).
//
// Browsers where the built-in speech recognition can't work during a call
// (Android, Firefox, Edge on Linux…) transcribe with a small in-browser model
// (lib/speaking-club/transcription/model-setup.ts). That model is a one-time download, so we
// ask the student first and download ONLY after they tap the button — the same
// pop-up appears on Wi-Fi and mobile data, with the size and a data warning, so
// nobody is surprised. It is MANDATORY and can't be skipped: the pop-up blocks
// the page until the download has finished, so nobody walks into a call
// without it. Once done it never appears again on that device.
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { onMeteredConnection } from "@/lib/speaking-club/device";
import { byokEnabled, cloudTranscribeEnabled, peerOffloadEnabled } from "@/lib/speaking-club/config";
import {
  cancelWhisperPrepare,
  startByokSetup,
  getWhisperPrepareServerState,
  getWhisperPrepareState,
  startWhisperPrepare,
  subscribeWhisperPrepare,
} from "@/lib/speaking-club/transcription/model-setup";
import { revalidateWhisperReady, whisperSetupRequired, whisperSizesMB } from "@/lib/speaking-club/transcription/model";

export function WhisperSetupDialog({ enabled }: { enabled: boolean }) {
  const prep = useSyncExternalStore(subscribeWhisperPrepare, getWhisperPrepareState, getWhisperPrepareServerState);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [metered, setMetered] = useState(false);
  const [totalMB, setTotalMB] = useState(60);

  // Browser-only checks, done after mount so server and client markup match.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void revalidateWhisperReady().then(() => {
      if (cancelled) return;
      setNeedsSetup(whisperSetupRequired());
      setMetered(onMeteredConnection());
      setTotalMB(whisperSizesMB().total);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return null;

  const busy = prep.phase === "downloading" || prep.phase === "finishing";
  const done = prep.phase === "ready";
  // Blocks until the download has finished: shown while it is still needed,
  // while downloading, on failure, and for the final "ready" message.
  const show = busy || done || prep.phase === "error" || needsSetup;
  if (!show) return null;

  if (byokEnabled()) {
    return (
      <ByokDialog
        phase={prep.phase}
        error={prep.error}
        onSubmit={(key) => void startByokSetup(key)}
        onClose={() => {
          setNeedsSetup(false);
          cancelWhisperPrepare();
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whisper-setup-title"
    >
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        {done ? (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              ✓ You&apos;re all set
            </h2>
            <Button
              className="mt-5 w-full"
              onClick={() => {
                setNeedsSetup(false);
                cancelWhisperPrepare();
              }}
            >
              Done
            </Button>
          </>
        ) : busy ? (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              Downloading…
            </h2>
            <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-leaf-100">
              <div
                className="h-full rounded-full bg-leaf-500 transition-[width] duration-300"
                style={{ width: `${Math.max(3, prep.percent)}%` }}
              />
            </div>
            <p className="mt-2 font-body text-sm text-ink">
              {prep.phase === "finishing"
                ? "Almost done…"
                : `${prep.percent}% (${prep.loadedMB} / ~${prep.expectedMB} MB)`}
            </p>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 font-body text-xs text-amber-800">
              Keep this page open. If your connection drops, retrying resumes the download.
            </p>
            <Button variant="outline" size="sm" className="mt-4 w-full" onClick={cancelWhisperPrepare}>
              Cancel
            </Button>
          </>
        ) : prep.phase === "error" ? (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              Download failed
            </h2>
            <p className="mt-2 font-body text-sm text-ink-soft">Check your connection and try again.</p>
            <Button className="mt-5 w-full" onClick={startWhisperPrepare}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              Set up AI feedback
            </h2>
            <p className="mt-2 font-body text-sm text-ink-soft">
              A one-time download (~{totalMB} MB) is needed to transcribe your speech on this device.
            </p>
            {cloudTranscribeEnabled() && (
              <p className="border border-leaf-500 mt-3 rounded-lg bg-white px-3 py-2 font-body text-xs text-ink-soft">
                On slow devices, short clips of your speech may be sent to a speech-to-text service (Groq). We don&apos;t store the audio.
              </p>
            )}
            {peerOffloadEnabled() && (
              <p className="border border-leaf-500 mt-3 rounded-lg bg-white px-3 py-2 font-body text-xs text-ink-soft">
                On slow devices, your speech may be sent to your call partner&apos;s device to be transcribed. It goes nowhere else.
              </p>
            )}
            <p
              className={
                "mt-3 rounded-lg px-3 py-2 font-body text-xs " +
                (metered ? "border border-amber-300 bg-amber-50 text-amber-800" : "border border-leaf-500 bg-white text-ink-soft")
              }
            >
              {metered
                ? `⚠ You're on mobile data. This uses ~${totalMB} MB. Wi-Fi is better.`
                : `Best on Wi-Fi. On mobile data it uses ~${totalMB} MB.`}
            </p>
            <Button className="mt-5 w-full" onClick={startWhisperPrepare}>
              Download
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ---- BYOK (bring your own Gemini key) version of the pop-up ------------------

const BYOK_ERRORS: Record<string, string> = {
  "bad-format": "That doesn't look like a Gemini key. Paste the full key.",
  "invalid-key": "Google rejected this key. Check it or create a new one.",
  forbidden: "This key isn't allowed. Make sure your Google account is verified 18+ and the key has no restrictions.",
  quota: "This key's free limit is used up. Try again later.",
  network: "Network problem. Check your connection and try again.",
};

function ByokDialog({
  phase,
  error,
  onSubmit,
  onClose,
}: {
  phase: "idle" | "downloading" | "finishing" | "ready" | "error";
  error?: string;
  onSubmit: (key: string) => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState("");
  const [agreed, setAgreed] = useState(false);
  const checking = phase === "finishing" || phase === "downloading";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whisper-setup-title"
    >
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        {phase === "ready" ? (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              ✓ You&apos;re all set
            </h2>
            <Button className="mt-5 w-full" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              Add your Gemini key
            </h2>
            <p className="mt-2 font-body text-sm text-ink-soft">Needed for AI feedback. One-time, takes a minute.</p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 font-body text-sm text-ink">
              <li>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-leaf-700 underline"
                >
                  aistudio.google.com/apikey
                </a>{" "}
                and sign in.
              </li>
              <li>Click “Create API key”.</li>
              <li>Paste the key below.</li>
            </ol>

            <label className="mt-4 block font-body text-xs font-semibold text-ink" htmlFor="gemini-key">
              Gemini API key
            </label>
            <input
              id="gemini-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={checking}
              placeholder="Paste your key"
              className="mt-1 w-full rounded-lg border border-leaf-200 px-3 py-2 font-body text-sm text-ink outline-none focus:border-leaf-500"
            />

            <label className="border border-leaf-500 mt-3 flex items-start gap-2 rounded-lg bg-white px-3 py-2 font-body text-xs text-ink-soft">
              <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={checking} />
              <span>
                I&apos;m 18 or older. I understand short clips of my speech are sent to Google (Gemini) using my own key, not through
                our servers.
              </span>
            </label>

            {phase === "error" && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 font-body text-xs text-red-700">
                {(error && BYOK_ERRORS[error]) || `Google is having a temporary problem. Try again shortly.${error ? ` (${error})` : ""}`}
              </p>
            )}

            <Button className="mt-4 w-full" disabled={checking || !agreed || key.trim().length === 0} onClick={() => onSubmit(key)}>
              {checking ? "Verifying…" : "Verify & save"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
