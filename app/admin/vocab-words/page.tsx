"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type VocabWord = {
  id: number;
  word: string;
  pronunciation: string | null;
  part_of_speech: string | null;
  meaning_en: string;
  synonym_1: string | null;
  synonym_2: string | null;
  example_1_en: string | null;
  example_1_bn: string | null;
  example_2_en: string | null;
  example_2_bn: string | null;
  daily_date: string | null;
  topic: string | null;
};

const EMPTY_FORM = {
  word: "",
  pronunciation: "",
  partOfSpeech: "",
  meaningEn: "",
  synonym1: "",
  synonym2: "",
  example1En: "",
  example1Bn: "",
  example2En: "",
  example2Bn: "",
  dailyDate: "",
  topic: "",
};

export default function AdminVocabWordsPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [words, setWords] = useState<VocabWord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/vocab-words", {
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setWords(data.words ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  // Autocomplete suggestions for the Topic field — every distinct topic
  // already used, so an admin adding today's 8th word doesn't have to
  // remember exactly how they spelled/capitalized it on word #1.
  const existingTopics = useMemo(() => {
    const set = new Set<string>();
    for (const w of words) if (w.topic) set.add(w.topic);
    return Array.from(set).sort();
  }, [words]);

  function startEdit(w: VocabWord) {
    setEditingId(w.id);
    setForm({
      word: w.word,
      pronunciation: w.pronunciation ?? "",
      partOfSpeech: w.part_of_speech ?? "",
      meaningEn: w.meaning_en,
      synonym1: w.synonym_1 ?? "",
      synonym2: w.synonym_2 ?? "",
      example1En: w.example_1_en ?? "",
      example1Bn: w.example_1_bn ?? "",
      example2En: w.example_2_en ?? "",
      example2Bn: w.example_2_bn ?? "",
      dailyDate: w.daily_date ?? "",
      topic: w.topic ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.word.trim() || !form.meaningEn.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, dailyDate: form.dailyDate || null, topic: form.topic || null };
      const wasEditing = editingId;
      const res = await fetch(
        editingId ? `/api/admin/vocab-words/${editingId}` : "/api/admin/vocab-words",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", "x-admin-secret": secret },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setEditingId(null);
      // After adding a fresh word (not editing an existing one), keep
      // the day + topic fields filled in rather than fully resetting —
      // a day's vocab set is usually many words added back-to-back
      // right after each other, so retyping the same date/topic every
      // single time would be pure friction. Editing still fully clears,
      // since there's no "next one" to chain off of there.
      setForm(wasEditing ? EMPTY_FORM : { ...EMPTY_FORM, dailyDate: form.dailyDate, topic: form.topic });
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this word? This also clears anyone's practice progress on it.")) return;
    await fetch(`/api/admin/vocab-words/${id}`, {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    load();
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
      <div className="w-full max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold">Vocab Words</h1>
          <Link href="/dashboard/vocab" className="underline text-black/50 text-sm">
            View student page →
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form
          onSubmit={submit}
          className="bg-white rounded-2xl p-6 border border-black/10 mb-8 space-y-4"
        >
          <h2 className="font-semibold">{editingId ? "Edit word" : "Add a new word"}</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Word *</label>
              <input
                value={form.word}
                onChange={(e) => setForm({ ...form, word: e.target.value })}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Pronunciation</label>
              <input
                value={form.pronunciation}
                onChange={(e) => setForm({ ...form, pronunciation: e.target.value })}
                placeholder="/əˈsweɪd/"
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Part of speech</label>
              <input
                value={form.partOfSpeech}
                onChange={(e) => setForm({ ...form, partOfSpeech: e.target.value })}
                placeholder="verb"
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Vocab set date (optional)
              </label>
              <input
                type="date"
                value={form.dailyDate}
                onChange={(e) => setForm({ ...form, dailyDate: e.target.value })}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-[11px] text-black/40">
                Every word with the same date shows together as one day&apos;s vocab set.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Topic (optional)</label>
            <input
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              placeholder="e.g. Travel, Business Meetings"
              list="topic-suggestions"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
            <datalist id="topic-suggestions">
              {existingTopics.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Meaning (English) *</label>
            <textarea
              value={form.meaningEn}
              onChange={(e) => setForm({ ...form, meaningEn: e.target.value })}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              rows={2}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Synonym 1</label>
              <input
                value={form.synonym1}
                onChange={(e) => setForm({ ...form, synonym1: e.target.value })}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Synonym 2</label>
              <input
                value={form.synonym2}
                onChange={(e) => setForm({ ...form, synonym2: e.target.value })}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Example sentence 1 (English)</label>
              <input
                value={form.example1En}
                onChange={(e) => setForm({ ...form, example1En: e.target.value })}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Example 1 বাংলা মানে</label>
              <input
                value={form.example1Bn}
                onChange={(e) => setForm({ ...form, example1Bn: e.target.value })}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Example sentence 2 (English)</label>
              <input
                value={form.example2En}
                onChange={(e) => setForm({ ...form, example2En: e.target.value })}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Example 2 বাংলা মানে</label>
              <input
                value={form.example2Bn}
                onChange={(e) => setForm({ ...form, example2Bn: e.target.value })}
                className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-full px-5 py-2.5 font-semibold text-white bg-black disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add word"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-full px-5 py-2.5 font-semibold border border-black/10"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <h2 className="font-semibold mb-3">
          All words {loading ? "" : `(${words.length})`}
        </h2>
        <div className="space-y-3">
          {words.map((w) => (
            <div key={w.id} className="bg-white rounded-xl border border-black/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    {w.word}
                    {w.daily_date && (
                      <span className="text-xs font-medium rounded-full bg-leaf-100 text-leaf-700 px-2 py-0.5">
                        {w.daily_date}
                        {w.topic ? ` · ${w.topic}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-black/60">{w.meaning_en}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => startEdit(w)}
                    className="text-sm underline text-black/50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(w.id)}
                    className="text-sm underline text-red-500"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!loading && words.length === 0 && (
            <p className="text-sm text-black/50">No words added yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
