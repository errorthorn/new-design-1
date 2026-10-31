"use client";

// UI for the post-call AI-feedback step (lib/speaking-club/post-call/engine.ts), mounted once
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
} from "@/lib/speaking-club/post-call/engine";

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
    status = "✓ Done. Your feedback is on its way.";
    estimate = "";
  } else if (st.phase === "loading") {
    status = `Preparing… ${st.modelPercent > 0 ? st.modelPercent + "%" : ""}`;
    estimate = "Estimating time…";
  } else if (st.phase === "submitting") {
    status = "Submitting…";
    estimate = "Almost done";
  } else {
    status = `Processing your speech… ${st.done}/${st.total}`;
    if (st.done >= 1 && st.transcribeStartedAt) {
      const perSeg = (now - st.transcribeStartedAt) / st.done / 1000;
      const remaining = Math.max(0, perSeg * (st.total - st.done));
      estimate =
        remaining < 60 ? `About ${Math.max(1, Math.ceil(remaining))} sec left` : `About ${Math.ceil(remaining / 60)} min left`;
    } else {
      estimate = "Estimating time…";
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="postcall-title"
    >
      <div className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-6 text-center shadow-2xl">
        <h2 id="postcall-title" className="font-display text-xl font-bold text-ink">
          {finished ? "✓ Ready" : "Creating your AI feedback"}
        </h2>
        {!finished && (
          <p className="mt-2 font-body text-sm text-ink-soft">
            Keep this page open until it finishes.
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
            <p className="text-xs text-ink-soft">Elapsed</p>
            <p className="font-display text-2xl font-bold tabular-nums text-ink">{mmss(elapsed)}</p>
          </div>
        </div>
        {estimate && <p className="mt-2 font-body text-xs text-ink-soft">{estimate}</p>}
        {finished && st.sampled && (
          <p className="mt-2 font-body text-xs text-ink-soft">
            Your call was long, so feedback is based on a sample spread across it.
          </p>
        )}

        {finished && (
          <button
            type="button"
            className="mt-5 w-full rounded-pill bg-ink px-4 py-2 font-body text-sm font-semibold text-cream"
            onClick={() => setClosedByUser(true)}
          >
            Continue
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
    text = `Preparing AI feedback… ${st.modelPercent > 0 ? st.modelPercent + "%" : ""} Keep this tab open.`;
  } else if (st.phase === "transcribing") {
    text = `Creating AI feedback… ${st.done}/${st.total} Keep this tab open.`;
  } else if (st.phase === "submitting") {
    text = "Submitting for AI feedback…";
  } else if (st.phase === "done") {
    text = "✓ Submitted. Feedback is on its way.";
    tone = "bg-leaf-600 text-white";
  } else {
    // The audio is kept on the device either way; the reason tells the student what to do.
    switch (st.reason) {
      case "key":
        text = "Your Gemini key isn't working. Add a new key on the Speaking Club page to get your feedback.";
        break;
      case "quota":
        text = "Your Gemini key's free limit is used up. We'll retry next time you open the site.";
        break;
      case "model":
        text = "Transcription is unavailable right now. We'll retry next time you open the site.";
        break;
      case "blocked":
        text = "Google couldn't process your speech. We'll retry next time you open the site.";
        break;
      case "network":
        text = "Network or Google problem. We'll retry next time you open the site.";
        break;
      default:
        text = "Couldn't create AI feedback. We'll retry next time you open the site.";
    }
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
