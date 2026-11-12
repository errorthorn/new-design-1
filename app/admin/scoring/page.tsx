"use client";

import { AdminShell } from "@/components/admin/admin-shell";
import { SearchBox, matchesSearch, EmptyState, Loading, ErrorLine } from "@/components/admin/ui";
import { AdminChecking } from "@/components/admin/admin-nav";
import { useAdminSession } from "@/hooks/use-admin-access";
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

  // An account the owner linked on /admin/staff opens this page without pasting a key:
  // the server checks the signed-in account on every request (see lib/admin-auth.ts).
  const adminSession = useAdminSession("scoring");
  useEffect(() => {
    if (adminSession.allowed) setUnlocked(true);
  }, [adminSession.allowed]);

  const [tab, setTab] = useState<FilterTab>("pending");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  if (!unlocked && adminSession.checking) return <AdminChecking />;

  const visible = attempts.filter((a) =>
    matchesSearch(query, a.students?.name, a.students?.phone, a.students?.user_email, (a as any).transcript)
  );

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setUnlocked(true);
          }}
          className="bg-white rounded-2xl p-6 border border-leaf-300 w-full max-w-sm"
        >
          <label className="block text-sm font-medium mb-1">Access key</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full rounded-xl border border-leaf-300 px-4 py-3 mb-4"
            placeholder="Access key"
          />
          <button className="w-full rounded-full py-3 font-bold text-white bg-leaf-600">Enter</button>
        </form>
      </div>
    );
  }

  return (
    <AdminShell current="scoring" title="Scoring" width="max-w-4xl">

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {(["pending", "scored", "all"] as FilterTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full px-4 py-2 text-sm font-semibold border ${
                  tab === t ? "bg-leaf-600 text-white border-leaf-600" : "bg-white text-ink-soft border-leaf-300"
                }`}
              >
                {t === "pending" ? "Pending" : t === "scored" ? "Scored" : "All"}
              </button>
            ))}
          </div>
          <SearchBox value={query} onChange={setQuery} placeholder="Search name, phone, email or transcript" className="min-w-[220px] flex-1 sm:max-w-sm" />
        </div>

        <ErrorLine text={error} />
        {loading && <Loading />}
        {!loading && visible.length === 0 && <EmptyState text={attempts.length === 0 ? "Nothing in this list." : "No match."} />}

        <div className="space-y-3">
          {visible.map((a) => (
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
    </AdminShell>
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
    <div className="bg-white rounded-2xl border border-leaf-300 overflow-hidden">
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
            <span className="inline-block rounded-full px-3 py-1 text-sm font-bold text-white bg-leaf-600">
              {attempt.score.toFixed(1)}
            </span>
          ) : (
            <span className="inline-block rounded-full px-3 py-1 text-sm font-semibold text-black/50 bg-cream">
              Pending
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-leaf-300 pt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold text-black/50 mb-1">TRANSCRIPT</p>
            <div className="max-h-56 overflow-y-auto text-sm bg-cream rounded-lg p-3 whitespace-pre-wrap">
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
                className="rounded-full px-4 py-2 text-sm font-semibold bg-cream disabled:opacity-60"
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
                className="w-full rounded-xl border border-leaf-300 px-3 py-2"
                placeholder="—"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-black/50 mb-1">FEEDBACK</label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-leaf-300 px-3 py-2"
                placeholder="Write about fluency, pronunciation, grammar, etc..."
              />
            </div>
          </div>

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}

          <button
            onClick={save}
            disabled={saving}
            className="rounded-full px-6 py-2 font-bold text-white bg-leaf-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
