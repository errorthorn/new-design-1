"use client";

import { AdminShell } from "@/components/admin/admin-shell";
import { SearchBox, matchesSearch, EmptyState } from "@/components/admin/ui";
import { AdminChecking } from "@/components/admin/admin-nav";
import { useAdminSession } from "@/hooks/use-admin-access";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Sparkles } from "lucide-react";

type Question = {
  id: string;
  quiz_id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  position: number;
  passage: string | null;
};

type Quiz = {
  id: string;
  title: string;
  description: string | null;
  time_limit_minutes: number | null;
  published: boolean;
  position: number;
  questions: Question[];
  attemptCount: number;
};

export default function AdminQuizPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  // An account the owner linked on /admin/staff opens this page without pasting a key:
  // the server checks the signed-in account on every request (see lib/admin-auth.ts).
  const adminSession = useAdminSession("quiz");
  useEffect(() => {
    if (adminSession.allowed) setUnlocked(true);
  }, [adminSession.allowed]);

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTimeLimit, setNewTimeLimit] = useState("");

  async function loadQuizzes() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/quizzes", { headers: { "x-admin-secret": secret } });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setQuizzes(data.quizzes ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked) loadQuizzes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function createQuiz(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setError(null);
    const res = await fetch("/api/admin/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        time_limit_minutes: newTimeLimit ? Number(newTimeLimit) : undefined,
        position: quizzes.length,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setNewTitle("");
    setNewDescription("");
    setNewTimeLimit("");
    loadQuizzes();
  }

  if (!unlocked && adminSession.checking) return <AdminChecking />;

  const shownQuizzes = quizzes.filter((qz) =>
    matchesSearch(query, qz.title, qz.description, ...qz.questions.map((x) => x.question))
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
    <AdminShell current="quiz" title="Quizzes" width="max-w-4xl">

        <MistakeQuizPanel secret={secret} />

        <form onSubmit={createQuiz} className="bg-white rounded-2xl border border-leaf-300 p-4 mb-6 space-y-2">          <p className="font-display text-base font-semibold">New quiz</p>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded-xl border border-leaf-300 px-3 py-2"
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Short description (optional)"
            rows={2}
            className="w-full text-sm rounded-xl border border-leaf-300 px-3 py-2"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={newTimeLimit}
              onChange={(e) => setNewTimeLimit(e.target.value)}
              placeholder="Time limit (minutes, optional)"
              className="flex-1 rounded-xl border border-leaf-300 px-3 py-2"
            />
            <button className="rounded-lg px-4 py-2 font-bold text-white bg-leaf-600 shrink-0">
              Create Quiz
            </button>
          </div>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {loading && <p className="text-sm text-black/50 mb-4">Loading…</p>}

        <SearchBox value={query} onChange={setQuery} placeholder="Search quizzes or questions" className="mb-5 max-w-sm" />

        {!loading && shownQuizzes.length === 0 && <EmptyState text={quizzes.length === 0 ? "No quizzes yet." : "No match."} />}

        <div className="space-y-6">
          {shownQuizzes.map((quiz) => (
            <QuizCard key={quiz.id} quiz={quiz} secret={secret} onChanged={loadQuizzes} />
          ))}
        </div>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Mistake-review quiz panel — gap-fix: an admin asked for a quiz that
// regenerates itself from Speaking Club mistake_logs on a schedule (see
// lib/mistake-quiz-generator.ts). A cron route handles the schedule; this
// panel just shows when it last ran and lets the admin force a run
// on-demand. The generated quiz itself shows up as a completely normal
// row in the list below once it exists — no special-casing needed there,
// it's edited/published through the exact same QuizCard as any other quiz.
// ---------------------------------------------------------------------------
type MistakeQuizStatus = {
  id: string;
  title: string;
  published: boolean;
  auto_generated_at: string | null;
  auto_mistakes_analyzed: number | null;
} | null;

function MistakeQuizPanel({ secret }: { secret: string }) {
  const [status, setStatus] = useState<MistakeQuizStatus>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/mistake-quiz", { headers: { "x-admin-secret": secret } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem loading status");
      setStatus(data.quiz ?? null);
    } catch (e: any) {
      setError(e.message ?? "There was a problem loading status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function regenerate() {
    setRegenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/mistake-quiz", { method: "POST", headers: { "x-admin-secret": secret } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem regenerating the quiz");
      if (data.generated) {
        setResult(`Generated ${data.questionCount} questions from ${data.mistakesAnalyzed} recent mistakes.`);
      } else if (data.reason === "not_enough_data") {
        setResult(`Not enough mistake data yet (only ${data.mistakesAnalyzed} logged in the last 24 hours) — skipped.`);
      } else if (data.reason === "already_taken") {
        setResult("Today's quiz has already been taken by a student, so it wasn't regenerated.");
      } else if (data.reason === "no_api_key") {
        setResult("GEMINI_MISTAKE_QUIZ_API_KEY isn't set — skipped.");
      }
      await load();
    } catch (e: any) {
      setError(e.message ?? "There was a problem regenerating the quiz");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-leaf-300 p-4 mb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-black/50 flex items-center gap-1.5">
            <Sparkles size={13} /> Daily mistake quiz
          </p>
        </div>
        <button
          onClick={regenerate}
          disabled={regenerating}
          className="flex items-center gap-1.5 rounded-full bg-leaf-600 text-white text-xs font-semibold px-4 py-2 disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={13} className={regenerating ? "animate-spin" : ""} />
          Regenerate now
        </button>
      </div>

      {!loading && (
        <p className="text-xs text-black/40 mt-3">
          {status
            ? `Last generated ${status.auto_generated_at ? new Date(status.auto_generated_at).toLocaleString() : "never"} · ${status.auto_mistakes_analyzed ?? 0} mistakes analyzed · ${status.published ? "published" : "not published yet"}`
            : "No daily quiz yet."}
        </p>
      )}

      {result && <p className="text-xs text-emerald-700 mt-2">{result}</p>}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}

function QuizCard({
  quiz,
  secret,
  onChanged,
}: {
  quiz: Quiz;
  secret: string;
  onChanged: () => void | Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [qText, setQText] = useState("");
  const [qPassage, setQPassage] = useState("");
  const [qOptions, setQOptions] = useState(["", "", "", ""]);
  const [qCorrect, setQCorrect] = useState(0);
  const [qExplanation, setQExplanation] = useState("");

  async function saveQuiz(updates: Partial<Pick<Quiz, "title" | "description" | "time_limit_minutes" | "published">>) {
    await fetch(`/api/admin/quizzes/${quiz.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(updates),
    });
    onChanged();
  }

  async function deleteQuiz() {
    if (!confirm(`This will delete "${quiz.title}" and all its questions/attempts — are you sure?`)) return;
    await fetch(`/api/admin/quizzes/${quiz.id}`, {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    onChanged();
  }

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!qText.trim() || qOptions.some((o) => !o.trim())) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/quiz-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({
          quiz_id: quiz.id,
          question: qText.trim(),
          passage: qPassage.trim() || undefined,
          options: qOptions.map((o) => o.trim()),
          correct_index: qCorrect,
          explanation: qExplanation.trim() || undefined,
          position: quiz.questions.length,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setQText("");
      setQPassage("");
      setQOptions(["", "", "", ""]);
      setQCorrect(0);
      setQExplanation("");
      onChanged();
    } finally {
      setAdding(false);
    }
  }

  async function deleteQuestion(id: string) {
    if (!confirm("This question will be deleted — are you sure?")) return;
    await fetch(`/api/admin/quiz-questions/${id}`, {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    onChanged();
  }

  return (
    <div className="bg-white rounded-2xl border border-leaf-300 p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <input
          defaultValue={quiz.title}
          onBlur={(e) => e.target.value.trim() && e.target.value !== quiz.title && saveQuiz({ title: e.target.value.trim() })}
          className="font-bold text-lg flex-1 rounded-xl border border-transparent hover:border-leaf-600 focus:border-black/20 px-2 py-1 -ml-2"
        />
        <label className="flex items-center gap-1.5 text-xs text-black/60 shrink-0">
          <input
            type="checkbox"
            checked={quiz.published}
            onChange={(e) => saveQuiz({ published: e.target.checked })}
          />
          Published
        </label>
        <button onClick={deleteQuiz} className="text-sm text-red-600 underline shrink-0">
          Delete
        </button>
      </div>

      <textarea
        defaultValue={quiz.description ?? ""}
        onBlur={(e) => e.target.value !== (quiz.description ?? "") && saveQuiz({ description: e.target.value })}
        placeholder="Description (optional)"
        rows={2}
        className="w-full text-sm rounded-md border border-leaf-300 px-2 py-1.5 mt-2"
      />

      <div className="flex items-center gap-2 mt-2 text-xs text-black/60">
        <span>Time limit (min):</span>
        <input
          type="number"
          min={1}
          defaultValue={quiz.time_limit_minutes ?? ""}
          onBlur={(e) => {
            const v = e.target.value ? Number(e.target.value) : null;
            if (v !== (quiz.time_limit_minutes ?? null)) saveQuiz({ time_limit_minutes: v ?? undefined });
          }}
          placeholder="untimed"
          className="w-24 rounded-md border border-leaf-300 px-2 py-1"
        />
        <span className="ml-auto">
          {quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"} · {quiz.attemptCount} attempt
          {quiz.attemptCount === 1 ? "" : "s"}
        </span>
      </div>

      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}

      <div className="mt-4 space-y-3">
        {quiz.questions.map((q, i) => (
          <div key={q.id} className="rounded-xl border border-leaf-300 p-3 text-sm">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="font-semibold">
                {i + 1}. {q.question}
              </p>
              <button onClick={() => deleteQuestion(q.id)} className="text-xs text-red-600 underline shrink-0">
                Delete
              </button>
            </div>
            {q.passage && (
              <p className="mb-2 rounded-md bg-cream px-2 py-1.5 text-xs text-black/60 whitespace-pre-wrap">
                <span className="font-semibold text-black/40">Passage: </span>
                {q.passage}
              </p>
            )}
            <ul className="space-y-0.5 text-black/70">
              {q.options.map((opt, idx) => (
                <li key={idx} className={idx === q.correct_index ? "font-semibold text-leaf-700" : ""}>
                  {idx === q.correct_index ? "✓ " : "· "}
                  {opt}
                </li>
              ))}
            </ul>
            {q.explanation && <p className="text-xs text-black/50 mt-1">Explanation: {q.explanation}</p>}
          </div>
        ))}
      </div>

      <form onSubmit={addQuestion} className="mt-4 border-t border-leaf-300 pt-4 space-y-2">
        <p className="text-xs font-semibold text-black/50">Add question</p>
        <textarea
          value={qPassage}
          onChange={(e) => setQPassage(e.target.value)}
          placeholder="Reading passage (optional)"
          rows={4}
          className="w-full text-sm rounded-md border border-leaf-300 px-2 py-1.5"
        />
        <textarea
          value={qText}
          onChange={(e) => setQText(e.target.value)}
          placeholder="Question text"
          rows={2}
          className="w-full text-sm rounded-md border border-leaf-300 px-2 py-1.5"
        />
        {qOptions.map((opt, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="radio"
              name={`correct-${quiz.id}`}
              checked={qCorrect === idx}
              onChange={() => setQCorrect(idx)}
              title="Correct answer"
            />
            <input
              value={opt}
              onChange={(e) => {
                const next = [...qOptions];
                next[idx] = e.target.value;
                setQOptions(next);
              }}
              placeholder={`Option ${idx + 1}`}
              className="flex-1 text-sm rounded-md border border-leaf-300 px-2 py-1.5"
            />
          </div>
        ))}
        <input
          value={qExplanation}
          onChange={(e) => setQExplanation(e.target.value)}
          placeholder="Explanation shown after attempt (optional)"
          className="w-full text-sm rounded-md border border-leaf-300 px-2 py-1.5"
        />
        <button disabled={adding} className="rounded-lg px-4 py-2 text-sm font-bold text-white bg-leaf-600 disabled:opacity-60">
          Add Question
        </button>
      </form>
    </div>
  );
}
