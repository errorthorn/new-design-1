"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Attempt = {
  id: string;
  started_at: string;
  completed_at: string | null;
  transcript: string | null;
  score: number | null;
  feedback: string | null;
  scored_at: string | null;
  audio_path: string | null;
  students: { name: string | null; phone: string | null; user_email: string | null } | null;
};

type FilterTab = "pending" | "scored" | "all";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminScoringPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [tab, setTab] = useState<FilterTab>("pending");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load(currentTab: FilterTab) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/attempts?status=${currentTab}`, {
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setAttempts(data.attempts ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked) load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, tab]);

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setUnlocked(true);
          }}
          className="bg-white rounded-2xl p-6 border border-black/10 w-full max-w-sm"
        >
          <label className="block text-sm font-medium mb-1">Admin secret</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full rounded-xl border border-black/10 px-4 py-3 mb-4"
            placeholder="ADMIN_SECRET"
          />
          <button className="w-full rounded-full py-3 font-bold text-white bg-black">Enter</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-12 flex justify-center">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-4 text-sm mb-4">
          <Link href="/admin/questions" className="underline text-black/50">
            Questions
          </Link>
          <Link href="/admin/members" className="underline text-black/50">
            Members
          </Link>
          <span className="font-semibold">Scoring</span>
          <Link href="/admin/payments" className="underline text-black/50">
            Payments
          </Link>
          <Link href="/admin/referrals" className="underline text-black/50">
            Referrals
          </Link>
          <Link href="/admin/bug-reports" className="underline text-black/50">
            Bug Reports
          </Link>
          <Link href="/admin/study-materials" className="underline text-black/50">
            Study Materials
          </Link>
          <Link href="/admin/testimonials" className="underline text-black/50">
            Testimonials
          </Link>
          <Link href="/admin/speaking-club" className="underline text-black/50">
            Speaking Club
          </Link>
          <Link href="/admin/mock-test" className="underline text-black/50">
            Mock Test
          </Link>
          <Link href="/admin/quiz" className="underline text-black/50">
            Quiz
          </Link>
          <Link href="/admin/classes" className="underline text-black/50">
            Classes
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2">Mock Test Scoring</h1>
        <p className="text-sm text-black/60 mb-6">
          Read the transcript for completed tests, listen to the recording, then save with a score and feedback.
        </p>

        <div className="flex gap-2 mb-6">
          {(["pending", "scored", "all"] as FilterTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-2 text-sm font-semibold border ${
                tab === t ? "bg-black text-white border-black" : "bg-white text-black/60 border-black/10"
              }`}
            >
              {t === "pending" ? "Pending" : t === "scored" ? "Scored" : "All"}
            </button>
          ))}
        </div>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {loading && <p className="text-sm text-black/50 mb-4">Loading...</p>}

        {!loading && attempts.length === 0 && (
          <p className="text-sm text-black/50">Nothing in this list.</p>
        )}

        <div className="space-y-3">
          {attempts.map((a) => (
            <AttemptRow
              key={a.id}
              attempt={a}
              secret={secret}
              open={openId === a.id}
              onToggle={() => setOpenId(openId === a.id ? null : a.id)}
              onSaved={(updated) => {
                setAttempts((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...updated } : x)));
                if (tab !== "all") load(tab);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AttemptRow({
  attempt,
  secret,
  open,
  onToggle,
  onSaved,
}: {
  attempt: Attempt;
  secret: string;
  open: boolean;
  onToggle: () => void;
  onSaved: (updated: Partial<Attempt>) => void;
}) {
  const [score, setScore] = useState(attempt.score != null ? String(attempt.score) : "");
  const [feedback, setFeedback] = useState(attempt.feedback ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  async function loadAudio() {
    if (!attempt.audio_path) return;
    setAudioLoading(true);
    setAudioError(null);
    try {
      const res = await fetch(`/api/admin/attempts/audio?attemptId=${attempt.id}`, {
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (!res.ok) {
        setAudioError(data.error ?? "Could not load recording.");
        return;
      }
      setAudioUrl(data.url);
    } finally {
      setAudioLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/attempts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({
          attemptId: attempt.id,
          score: score === "" ? null : Number(score),
          feedback,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "Could not save.");
        return;
      }
      onSaved({ score: score === "" ? null : Number(score), feedback, scored_at: new Date().toISOString() });
    } finally {
      setSaving(false);
    }
  }

  const student = attempt.students;

  return (
    <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-4 text-left">
        <div>
          <p className="font-semibold">{student?.name || "(no name)"}</p>
          <p className="text-xs text-black/50">
            {student?.phone} {student?.user_email ? `· ${student.user_email}` : ""}
          </p>
          <p className="text-xs text-black/40 mt-1">
            {attempt.completed_at ? formatDateTime(attempt.completed_at) : formatDateTime(attempt.started_at)}
          </p>
        </div>
        <div className="text-right">
          {attempt.score != null ? (
            <span className="inline-block rounded-full px-3 py-1 text-sm font-bold text-white bg-[#2E6B2A]">
              {attempt.score.toFixed(1)}
            </span>
          ) : (
            <span className="inline-block rounded-full px-3 py-1 text-sm font-semibold text-black/50 bg-black/5">
              Pending
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-black/10 pt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold text-black/50 mb-1">TRANSCRIPT</p>
            <div className="max-h-56 overflow-y-auto text-sm bg-black/5 rounded-lg p-3 whitespace-pre-wrap">
              {attempt.transcript?.trim() ? attempt.transcript : "No transcript saved."}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-black/50 mb-1">RECORDING</p>
            {!attempt.audio_path && <p className="text-sm text-black/40">There is no recording for this attempt.</p>}
            {attempt.audio_path && !audioUrl && (
              <button
                onClick={loadAudio}
                disabled={audioLoading}
                className="rounded-full px-4 py-2 text-sm font-semibold bg-black/5 disabled:opacity-60"
              >
                {audioLoading ? "Loading..." : "▶ Play recording"}
              </button>
            )}
            {audioError && <p className="text-sm text-red-600 mt-1">{audioError}</p>}
            {audioUrl && <audio controls src={audioUrl} className="w-full mt-1" />}
          </div>

          <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
            <div>
              <label className="block text-xs font-semibold text-black/50 mb-1">SCORE (0–9)</label>
              <input
                type="number"
                min={0}
                max={9}
                step={0.5}
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="—"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-black/50 mb-1">FEEDBACK</label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="Write about fluency, pronunciation, grammar, etc..."
              />
            </div>
          </div>

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}

          <button
            onClick={save}
            disabled={saving}
            className="rounded-full px-6 py-2 font-bold text-white bg-[#6FC24A] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
