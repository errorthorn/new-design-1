"use client";

// UI for the post-call AI-feedback step (lib/speaking-post-call.ts), mounted once
// in the root layout so it follows the student to any page.
//
// After a Speaking Club call the student's speech is turned into text ON THEIR
// OWN DEVICE. For the call they have JUST finished this shows a full-screen wait
// with a running timer and a time estimate — they stay until it is done, however
// long their device needs. (The audio is also saved on the device, so even if
// the tab is closed it is finished on a later visit.) Sessions resumed from an
// earlier visit use a small, non-blocking banner instead.
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getPostCallServerState,
  getPostCallState,
  resumePendingSessions,
  subscribePostCall,
  type PostCallState,
} from "@/lib/speaking-post-call";

function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function BlockingOverlay({ st }: { st: PostCallState }) {
  const [now, setNow] = useState(() => Date.now());
  const [closedByUser, setClosedByUser] = useState(false);

  // Running clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Keep a phone's screen awake while we wait (a locked screen pauses the work).
  useEffect(() => {
    let lock: any = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (!cancelled && "wakeLock" in navigator && document.visibilityState === "visible") {
          lock = await (navigator as any).wakeLock.request("screen");
        }
      } catch {
        // not supported / denied — fine
      }
    };
    void acquire();
    const onVis = () => void acquire(); // the lock is dropped when the tab is hidden
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      try {
        void lock?.release();
      } catch {
        // ignore
      }
    };
  }, []);

  if (closedByUser) return null;

  const finished = st.phase === "done";
  const elapsed = (now - st.startedAt) / 1000;
  const pct = st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;

  let status: string;
  let estimate: string;
  if (finished) {
    status = "✓ শেষ! AI feedback শীঘ্রই পাবেন।";
    estimate = "";
  } else if (st.phase === "loading") {
    status = `প্রস্তুতি হচ্ছে… ${st.modelPercent > 0 ? st.modelPercent + "%" : ""}`;
    estimate = "আনুমানিক সময় হিসাব করা হচ্ছে…";
  } else if (st.phase === "submitting") {
    status = "জমা দেওয়া হচ্ছে…";
    estimate = "প্রায় শেষ";
  } else {
    status = `আপনার কথা থেকে feedback তৈরি হচ্ছে… ${st.done}/${st.total}`;
    if (st.done >= 1 && st.transcribeStartedAt) {
      const perSeg = (now - st.transcribeStartedAt) / st.done / 1000;
      const remaining = Math.max(0, perSeg * (st.total - st.done));
      estimate =
        remaining < 60 ? `আনুমানিক বাকি: ~${Math.max(1, Math.ceil(remaining))} সেকেন্ড` : `আনুমানিক বাকি: ~${Math.ceil(remaining / 60)} মিনিট`;
    } else {
      estimate = "আনুমানিক সময় হিসাব করা হচ্ছে…";
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="postcall-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
        <h2 id="postcall-title" className="font-display text-xl font-bold text-ink">
          {finished ? "✓ প্রস্তুত" : "AI Feedback তৈরি হচ্ছে"}
        </h2>
        {!finished && (
          <p className="mt-2 font-body text-sm text-ink-soft">
            আপনার ডিভাইসে কথা থেকে feedback তৈরি হচ্ছে। শেষ না হওয়া পর্যন্ত এই পেজ বা অ্যাপ বন্ধ করবেন না।
          </p>
        )}

        <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-leaf-100">
          <div
            className="h-full rounded-full bg-leaf-500 transition-[width] duration-500"
            style={{ width: `${finished ? 100 : Math.max(4, pct)}%` }}
          />
        </div>
        <p className="mt-2 font-body text-sm text-ink">{status}</p>

        <div className="mt-4 flex items-center justify-center gap-6 font-body text-sm">
          <div>
            <p className="text-xs text-ink-soft">সময় লেগেছে</p>
            <p className="font-display text-2xl font-bold tabular-nums text-ink">{mmss(elapsed)}</p>
          </div>
        </div>
        {estimate && <p className="mt-2 font-body text-xs text-ink-soft">{estimate}</p>}

        {finished && (
          <button
            type="button"
            className="mt-5 w-full rounded-pill bg-ink px-4 py-2 font-body text-sm font-semibold text-cream"
            onClick={() => setClosedByUser(true)}
          >
            চালিয়ে যান
          </button>
        )}
      </div>
    </div>
  );
}

export function PostCallBanner() {
  const st = useSyncExternalStore(subscribePostCall, getPostCallState, getPostCallServerState);

  // Finish sessions an earlier visit couldn't (tab closed, offline, crash).
  useEffect(() => {
    const t = setTimeout(() => void resumePendingSessions(), 4000); // after the page has settled
    const onFocus = () => void resumePendingSessions();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (st.phase === "idle") return null;

  // The call the student just left: hold them on the wait screen with a timer.
  if (st.blocking && st.phase !== "error") return <BlockingOverlay key={st.startedAt} st={st} />;

  let text: string;
  let tone = "bg-ink text-cream";
  if (st.phase === "loading") {
    text = `AI feedback তৈরির জন্য প্রস্তুতি… ${st.modelPercent > 0 ? st.modelPercent + "%" : ""} — এই ট্যাব খোলা রাখুন`;
  } else if (st.phase === "transcribing") {
    text = `আগের কলের AI feedback তৈরি হচ্ছে… ${st.done}/${st.total} — এই ট্যাব খোলা রাখুন`;
  } else if (st.phase === "submitting") {
    text = "AI feedback-এর জন্য জমা দেওয়া হচ্ছে…";
  } else if (st.phase === "done") {
    text = "✓ জমা হয়েছে — AI feedback শীঘ্রই পাবেন";
    tone = "bg-leaf-600 text-white";
  } else {
    text = "এখন AI feedback তৈরি করা যায়নি — পরের বার সাইট খুললে নিজে থেকে আবার চেষ্টা হবে।";
    tone = "bg-amber-600 text-white";
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[90] flex justify-center px-4" role="status" aria-live="polite">
      <div className={"pointer-events-auto max-w-md rounded-full px-4 py-2 font-body text-xs shadow-lg " + tone}>
        {text}
      </div>
    </div>
  );
}
