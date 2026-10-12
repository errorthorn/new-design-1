"use client";

// One-time "AI feedback setup" pop-up for Speaking Club (dashboard).
//
// Browsers where the built-in speech recognition can't work during a call
// (Android, Firefox, Edge on Linux…) transcribe with a small in-browser model
// (lib/speaking-whisper-client.ts). That model is a one-time download, so we
// ask the student first and download ONLY after they tap the button — the same
// pop-up appears on Wi-Fi and mobile data, with the size and a data warning, so
// nobody is surprised. It is MANDATORY and can't be skipped: the pop-up blocks
// the page until the download has finished, so nobody walks into a call
// without it. Once done it never appears again on that device.
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  cancelWhisperPrepare,
  getWhisperPrepareServerState,
  getWhisperPrepareState,
  onMeteredConnection,
  revalidateWhisperReady,
  startWhisperPrepare,
  subscribeWhisperPrepare,
  whisperSetupRequired,
  whisperSizesMB,
} from "@/lib/speaking-whisper-client";

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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whisper-setup-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        {done ? (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              ✓ প্রস্তুত!
            </h2>
            <p className="mt-2 font-body text-sm text-ink-soft">
              এখন থেকে এই ডিভাইসে আপনার কথা থেকে AI feedback তৈরি হবে। আর কিছু করতে হবে না।
            </p>
            <Button
              className="mt-5 w-full"
              onClick={() => {
                setNeedsSetup(false);
                cancelWhisperPrepare();
              }}
            >
              ঠিক আছে
            </Button>
          </>
        ) : busy ? (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              ডাউনলোড হচ্ছে…
            </h2>
            <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-leaf-100">
              <div
                className="h-full rounded-full bg-leaf-500 transition-[width] duration-300"
                style={{ width: `${Math.max(3, prep.percent)}%` }}
              />
            </div>
            <p className="mt-2 font-body text-sm text-ink">
              {prep.phase === "finishing"
                ? "প্রায় শেষ — চালু করা হচ্ছে…"
                : `${prep.percent}% (${prep.loadedMB} / প্রায় ${prep.expectedMB} MB)`}
            </p>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 font-body text-xs text-amber-800">
              এই পেজ বন্ধ করবেন না বা অন্য অ্যাপে যাবেন না। নেট কেটে গেলে আবার চেষ্টা করলে আগের অংশ থেকে চলবে।
            </p>
            <Button variant="outline" size="sm" className="mt-4 w-full" onClick={cancelWhisperPrepare}>
              থামান
            </Button>
          </>
        ) : prep.phase === "error" ? (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              ডাউনলোড সম্পূর্ণ হয়নি
            </h2>
            <p className="mt-2 font-body text-sm text-ink-soft">
              ইন্টারনেট ঠিক আছে কিনা দেখে আবার চেষ্টা করুন। আগে যতটুকু নামানো হয়েছে সেটা রাখা আছে।
            </p>
            <Button className="mt-5 w-full" onClick={startWhisperPrepare}>
              আবার চেষ্টা করুন
            </Button>
          </>
        ) : (
          <>
            <h2 id="whisper-setup-title" className="font-display text-xl font-bold text-ink">
              AI Feedback চালু করতে একবার সেটআপ লাগবে
            </h2>
            <p className="mt-2 font-body text-sm text-ink-soft">
              কলের সময় আপনার কথা ঠিকভাবে লিখে নিয়ে AI feedback দিতে একটি ছোট AI ফাইল (প্রায় {totalMB} MB) একবার
              ডাউনলোড করতে হবে। এটা <b>শুধু একবার</b> — এরপর এই ডিভাইসে আর লাগবে না।
            </p>
            <p
              className={
                "mt-3 rounded-lg px-3 py-2 font-body text-xs " +
                (metered ? "bg-amber-50 text-amber-800" : "bg-leaf-50 text-ink-soft")
              }
            >
              {metered
                ? `⚠ আপনি মোবাইল ডাটা ব্যবহার করছেন — প্রায় ${totalMB} MB ডাটা খরচ হবে। Wi-Fi থাকলে সেটাতে করা ভালো।`
                : `Wi-Fi-তে করা ভালো। মোবাইল ডাটাতেও চলবে, তবে প্রায় ${totalMB} MB ডাটা খরচ হবে।`}
            </p>
            <p className="mt-3 font-body text-xs text-ink-soft">
              Speaking Club-এ কলে ঢুকতে এটা একবার ডাউনলোড করা প্রয়োজন।
            </p>
            <Button className="mt-5 w-full" onClick={startWhisperPrepare}>
              ডাউনলোড করুন
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
