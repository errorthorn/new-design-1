"use client";

import { useEffect, useMemo, useState } from "react";

type Question = { id: string; question: string; part: 1 | 2 | 3; position: number };

const PART_LABEL: Record<1 | 2 | 3, string> = {
  1: "Part 1 — Introduction",
  2: "Part 2 — Cue Card",
  3: "Part 3 — Discussion",
};
const PART_HINT: Record<1 | 2 | 3, string> = {
  1: "General introductory questions, asked one after another.",
  2: "A topic — cue card style ('Describe a... You should say: ...'). Keeping just one or two is enough; the examiner will pick one from here.",
  3: "Deeper discussion questions on the Part 2 topic.",
};

export default function AdminQuestionsPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [newPart, setNewPart] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [savedTopic, setSavedTopic] = useState("");
  const [savingTopic, setSavingTopic] = useState(false);

  async function loadQuestions() {
    const res = await fetch("/api/mock-test/questions", {
      headers: { "x-admin-secret": secret },
    });
    const data = await res.json();
    setQuestions(data.questions ?? []);
  }

  async function loadTopic() {
    const res = await fetch("/api/mock-test/topic", {
      headers: { "x-admin-secret": secret },
    });
    const data = await res.json();
    setTopic(data.topic ?? "");
    setSavedTopic(data.topic ?? "");
  }

  useEffect(() => {
    // Wait until the admin has actually entered the secret — GET now
    // requires it too, and calling before "unlocked" would just 401.
    if (unlocked) {
      loadQuestions();
      loadTopic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function saveTopic(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavingTopic(true);
    const res = await fetch("/api/mock-test/topic", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ topic: topic.trim() }),
    });
    setSavingTopic(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Something went wrong");
      return;
    }
    const data = await res.json();
    setSavedTopic(data.topic ?? "");
  }

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newQuestion.trim()) return;

    const positionInPart = questions.filter((q) => q.part === newPart).length;

    const res = await fetch("/api/mock-test/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ question: newQuestion.trim(), part: newPart, position: positionInPart }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Something went wrong");
      return;
    }
    setNewQuestion("");
    loadQuestions();
  }

  async function removeQuestion(id: string) {
    setError(null);
    const res = await fetch("/api/mock-test/questions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Something went wrong");
      return;
    }
    loadQuestions();
  }

  const byPart = useMemo(() => {
    const groups: Record<1 | 2 | 3, Question[]> = { 1: [], 2: [], 3: [] };
    for (const q of questions) groups[q.part]?.push(q);
    return groups;
  }, [questions]);

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
          <button className="w-full rounded-full py-3 font-bold text-white bg-black">
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-12 flex justify-center">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-4 text-sm mb-4">
          <span className="font-semibold">Questions</span>
          <a href="/admin/members" className="underline text-black/50">
            Members
          </a>
          <a href="/admin/scoring" className="underline text-black/50">
            Scoring
          </a>
          <a href="/admin/payments" className="underline text-black/50">
            Payments
          </a>
          <a href="/admin/referrals" className="underline text-black/50">
            Referrals
          </a>
          <a href="/admin/bug-reports" className="underline text-black/50">
            Bug Reports
          </a>
          <a href="/admin/study-materials" className="underline text-black/50">
            Study Materials
          </a>
          <a href="/admin/testimonials" className="underline text-black/50">
            Testimonials
          </a>
          <a href="/admin/speaking-club" className="underline text-black/50">
            Speaking Club
          </a>
          <a href="/admin/mock-test" className="underline text-black/50">
            Mock Test
          </a>
          <a href="/admin/quiz" className="underline text-black/50">
            Quiz
          </a>
          <a href="/admin/classes" className="underline text-black/50">
            Classes
          </a>
        </div>

        <h1 className="text-2xl font-bold mb-1">Mock Test Questions</h1>
        <p className="text-sm text-black/50 mb-6">
          IELTS-style 3 parts — add questions separately for each. The live test will run in the order Part 1 → 2
          → 3 according to this list.
        </p>

        <form onSubmit={saveTopic} className="bg-white rounded-2xl border border-black/10 p-4 mb-8 space-y-2">
          <h2 className="text-sm font-bold text-black/70">This week&apos;s Part 1 topic</h2>
          <p className="text-xs text-black/45">
            Shown to the student on the test page during Part 1 — e.g. &quot;Your hometown&quot; or &quot;Your
            studies&quot;. Doesn&apos;t affect which questions the examiner actually asks, just gives the student a
            heads-up on what to expect.
          </p>
          <div className="flex gap-2">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="flex-1 rounded-xl border border-black/10 px-4 py-3 bg-white text-sm"
              placeholder="e.g. Your hometown"
            />
            <button
              disabled={savingTopic || topic.trim() === savedTopic}
              className="rounded-xl px-4 py-3 font-bold text-white bg-[#6FC24A] disabled:opacity-40"
            >
              {savingTopic ? "Saving..." : "Save"}
            </button>
          </div>
        </form>

        <form onSubmit={addQuestion} className="bg-white rounded-2xl border border-black/10 p-4 mb-8 space-y-3">
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setNewPart(p)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold border transition-colors ${
                  newPart === p
                    ? "bg-[#6FC24A] border-[#6FC24A] text-white"
                    : "bg-white border-black/10 text-black/60"
                }`}
              >
                Part {p}
              </button>
            ))}
          </div>
          <p className="text-xs text-black/45">{PART_HINT[newPart]}</p>
          <div className="flex gap-2">
            <textarea
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              rows={newPart === 2 ? 4 : 2}
              className="flex-1 rounded-xl border border-black/10 px-4 py-3 bg-white text-sm"
              placeholder={
                newPart === 2
                  ? "Describe a book you recently read.\nYou should say: what it was, why you chose it, what it was about, and explain whether you'd recommend it."
                  : "Write a new question..."
              }
            />
            <button className="rounded-xl px-4 py-3 font-bold text-white bg-[#6FC24A] self-start">Add</button>
          </div>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {([1, 2, 3] as const).map((p) => (
          <div key={p} className="mb-7">
            <h2 className="text-sm font-bold text-black/70 mb-2">{PART_LABEL[p]}</h2>
            <ul className="space-y-2">
              {byPart[p].map((q, i) => (
                <li
                  key={q.id}
                  className="bg-white rounded-xl border border-black/10 px-4 py-3 flex justify-between items-start gap-3"
                >
                  <span className="whitespace-pre-wrap text-sm">
                    {i + 1}. {q.question}
                  </span>
                  <button
                    onClick={() => removeQuestion(q.id)}
                    className="text-red-600 text-sm underline shrink-0"
                  >
                    Delete
                  </button>
                </li>
              ))}
              {byPart[p].length === 0 && (
                <p className="text-sm text-black/40">No questions have been added to this part yet.</p>
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
