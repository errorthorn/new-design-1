"use client";

import { AdminShell } from "@/components/admin/admin-shell";
import { SearchBox, matchesSearch } from "@/components/admin/ui";
import { AdminChecking } from "@/components/admin/admin-nav";
import { useAdminSession } from "@/hooks/use-admin-access";
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

  // An account the owner linked on /admin/staff opens this page without pasting a key:
  // the server checks the signed-in account on every request (see lib/admin-auth.ts).
  const adminSession = useAdminSession("questions");
  useEffect(() => {
    if (adminSession.allowed) setUnlocked(true);
  }, [adminSession.allowed]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const [newPart, setNewPart] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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

  if (!unlocked && adminSession.checking) return <AdminChecking />;

  const shown = (part: 1 | 2 | 3) => byPart[part].filter((q) => matchesSearch(query, q.question));

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
          <button className="w-full rounded-full py-3 font-bold text-white bg-leaf-600">
            Enter
          </button>
        </form>
      </div>
    );
  }

  return (
    <AdminShell current="questions" title="Questions" width="max-w-3xl">

        <form onSubmit={saveTopic} className="bg-white rounded-2xl border border-leaf-300 p-4 mb-8 space-y-2">
          <h2 className="font-display text-base font-semibold">Part 1 topic</h2>
          <div className="flex gap-2">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="flex-1 rounded-xl border border-leaf-300 px-4 py-3 bg-white text-sm"
              placeholder="e.g. Your hometown"
            />
            <button
              disabled={savingTopic || topic.trim() === savedTopic}
              className="rounded-xl px-4 py-3 font-bold text-white bg-leaf-600 disabled:opacity-40"
            >
              {savingTopic ? "Saving..." : "Save"}
            </button>
          </div>
        </form>

        <form onSubmit={addQuestion} className="bg-white rounded-2xl border border-leaf-300 p-4 mb-8 space-y-3">
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setNewPart(p)}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold border transition-colors ${
                  newPart === p
                    ? "bg-leaf-600 border-[#6FC24A] text-white"
                    : "bg-white border-leaf-300 text-black/60"
                }`}
              >
                Part {p}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              rows={newPart === 2 ? 4 : 2}
              className="flex-1 rounded-xl border border-leaf-300 px-4 py-3 bg-white text-sm"
              placeholder="Question"
            />
            <button className="rounded-xl px-4 py-3 font-bold text-white bg-leaf-600 self-start">Add</button>
          </div>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <SearchBox value={query} onChange={setQuery} placeholder="Search questions" className="mb-5 max-w-sm" />

        {([1, 2, 3] as const).map((p) => (
          <div key={p} className="mb-7">
            <h2 className="font-display text-base font-semibold mb-2">{PART_LABEL[p]}</h2>
            <ul className="space-y-2">
              {shown(p).map((q, i) => (
                <li
                  key={q.id}
                  className="bg-white rounded-2xl border border-leaf-300 px-4 py-3 flex justify-between items-start gap-3"
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
              {shown(p).length === 0 && <p className="text-sm text-ink-soft/60">{query.trim() ? "No match." : "Empty."}</p>}
            </ul>
          </div>
        ))}
    </AdminShell>
  );
}
