"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-4 text-sm mb-4 flex-wrap">
          <Link href="/admin/questions" className="underline text-black/50">
            Questions
          </Link>
          <Link href="/admin/members" className="underline text-black/50">
            Members
          </Link>
          <Link href="/admin/scoring" className="underline text-black/50">
            Scoring
          </Link>
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
          <span className="font-semibold">Quiz</span>
          <Link href="/admin/classes" className="underline text-black/50">
            Classes
          </Link>
        </div>

        <h1 className="text-2xl font-bold mb-2">Quiz</h1>
        <p className="text-sm text-black/60 mb-6">
          Create a quiz, add MCQ questions to it, then flip &ldquo;Published&rdquo; on when it&apos;s ready.
          Members only ever see published quizzes on /dashboard/quiz, and each member can take a given
          quiz once — their score and answers stay visible to them afterward as a review.
        </p>

        <form onSubmit={createQuiz} className="bg-white rounded-xl border border-black/10 p-4 mb-6 space-y-2">
          <p className="text-xs font-semibold text-black/50">New quiz</p>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title, e.g. Week 6: Conditional Sentences"
            className="w-full rounded-lg border border-black/10 px-3 py-2"
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Short description (optional)"
            rows={2}
            className="w-full text-sm rounded-lg border border-black/10 px-3 py-2"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={newTimeLimit}
              onChange={(e) => setNewTimeLimit(e.target.value)}
              placeholder="Time limit (minutes, optional)"
              className="flex-1 rounded-lg border border-black/10 px-3 py-2"
            />
            <button className="rounded-lg px-4 py-2 font-bold text-white bg-[#6FC24A] shrink-0">
              Create Quiz
            </button>
          </div>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {loading && <p className="text-sm text-black/50 mb-4">Loading…</p>}

        <div className="space-y-6">
          {quizzes.map((quiz) => (
            <QuizCard key={quiz.id} quiz={quiz} secret={secret} onChanged={loadQuizzes} />
          ))}
        </div>
      </div>
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
    <div className="bg-white rounded-xl border border-black/10 p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <input
          defaultValue={quiz.title}
          onBlur={(e) => e.target.value.trim() && e.target.value !== quiz.title && saveQuiz({ title: e.target.value.trim() })}
          className="font-bold text-lg flex-1 rounded-lg border border-transparent hover:border-black/10 focus:border-black/20 px-2 py-1 -ml-2"
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
        className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5 mt-2"
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
          className="w-24 rounded-md border border-black/10 px-2 py-1"
        />
        <span className="ml-auto">
          {quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"} · {quiz.attemptCount} attempt
          {quiz.attemptCount === 1 ? "" : "s"}
        </span>
      </div>

      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}

      <div className="mt-4 space-y-3">
        {quiz.questions.map((q, i) => (
          <div key={q.id} className="rounded-lg border border-black/10 p-3 text-sm">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="font-semibold">
                {i + 1}. {q.question}
              </p>
              <button onClick={() => deleteQuestion(q.id)} className="text-xs text-red-600 underline shrink-0">
                Delete
              </button>
            </div>
            {q.passage && (
              <p className="mb-2 rounded-md bg-black/5 px-2 py-1.5 text-xs text-black/60 whitespace-pre-wrap">
                <span className="font-semibold text-black/40">Passage: </span>
                {q.passage}
              </p>
            )}
            <ul className="space-y-0.5 text-black/70">
              {q.options.map((opt, idx) => (
                <li key={idx} className={idx === q.correct_index ? "font-semibold text-[#2E6B2A]" : ""}>
                  {idx === q.correct_index ? "✓ " : "· "}
                  {opt}
                </li>
              ))}
            </ul>
            {q.explanation && <p className="text-xs text-black/50 mt-1">Explanation: {q.explanation}</p>}
          </div>
        ))}
      </div>

      <form onSubmit={addQuestion} className="mt-4 border-t border-black/10 pt-4 space-y-2">
        <p className="text-xs font-semibold text-black/50">Add question</p>
        <textarea
          value={qPassage}
          onChange={(e) => setQPassage(e.target.value)}
          placeholder="Reading passage shown on the left side of the quiz screen (optional — leave blank for a normal full-width question)"
          rows={4}
          className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
        />
        <textarea
          value={qText}
          onChange={(e) => setQText(e.target.value)}
          placeholder="Question text"
          rows={2}
          className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
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
              className="flex-1 text-sm rounded-md border border-black/10 px-2 py-1.5"
            />
          </div>
        ))}
        <input
          value={qExplanation}
          onChange={(e) => setQExplanation(e.target.value)}
          placeholder="Explanation shown after attempt (optional)"
          className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
        />
        <button disabled={adding} className="rounded-lg px-4 py-2 text-sm font-bold text-white bg-[#6FC24A] disabled:opacity-60">
          Add Question
        </button>
      </form>
    </div>
  );
}
