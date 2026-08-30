"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type NoteRow = {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  file_url: string | null;
  published: boolean;
  position: number;
  created_at: string;
};

export default function AdminClassNotesPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newFileUrl, setNewFileUrl] = useState("");

  async function loadNotes() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/class-notes", { headers: { "x-admin-secret": secret } });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setNotes(data.notes ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked) loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function createNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setError(null);
    const res = await fetch("/api/admin/class-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        content: newContent.trim() || undefined,
        file_url: newFileUrl.trim() || undefined,
        position: notes.length,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setNewTitle("");
    setNewDescription("");
    setNewContent("");
    setNewFileUrl("");
    loadNotes();
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
          <Link href="/admin/classes" className="underline text-black/50">
            Classes
          </Link>
          <Link href="/admin/mock-test" className="underline text-black/50">
            Mock Test
          </Link>
          <span className="font-semibold">Class Notes</span>
        </div>

        <h1 className="text-2xl font-bold mb-2">Class Notes</h1>
        <p className="text-sm text-black/60 mb-6">
          Add a note — pasted text, a link to an uploaded file (Drive/PDF/etc), or both. Flip
          &ldquo;Published&rdquo; on when it&apos;s ready — members only ever see published notes on
          /dashboard/class-notes.
        </p>

        <form onSubmit={createNote} className="bg-white rounded-xl border border-black/10 p-4 mb-6 space-y-2">
          <p className="text-xs font-semibold text-black/50">New note</p>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title, e.g. Week 6: Conditional Sentences — key points"
            className="w-full rounded-lg border border-black/10 px-3 py-2"
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Short description (optional)"
            rows={2}
            className="w-full text-sm rounded-lg border border-black/10 px-3 py-2"
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Note content, pasted directly (optional)"
            rows={4}
            className="w-full text-sm rounded-lg border border-black/10 px-3 py-2"
          />
          <input
            value={newFileUrl}
            onChange={(e) => setNewFileUrl(e.target.value)}
            placeholder="Link to uploaded file (Drive/PDF/etc, optional)"
            className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
          <button className="rounded-lg px-4 py-2 font-bold text-white bg-[#6FC24A]">Create note</button>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {loading && <p className="text-sm text-black/50 mb-4">Loading…</p>}

        <div className="space-y-4">
          {notes.map((n) => (
            <NoteCard key={n.id} item={n} secret={secret} onChanged={loadNotes} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NoteCard({
  item,
  secret,
  onChanged,
}: {
  item: NoteRow;
  secret: string;
  onChanged: () => void | Promise<void>;
}) {
  async function save(updates: Partial<NoteRow>) {
    await fetch(`/api/admin/class-notes/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(updates),
    });
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    await fetch(`/api/admin/class-notes/${item.id}`, {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    onChanged();
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <input
          defaultValue={item.title}
          onBlur={(e) => e.target.value.trim() && e.target.value !== item.title && save({ title: e.target.value.trim() })}
          className="font-bold text-lg flex-1 rounded-lg border border-transparent hover:border-black/10 focus:border-black/20 px-2 py-1 -ml-2"
        />
        <label className="flex items-center gap-1.5 text-xs text-black/60 shrink-0">
          <input type="checkbox" checked={item.published} onChange={(e) => save({ published: e.target.checked })} />
          Published
        </label>
        <button onClick={remove} className="text-sm text-red-600 underline shrink-0">
          Delete
        </button>
      </div>

      <textarea
        defaultValue={item.description ?? ""}
        onBlur={(e) => e.target.value !== (item.description ?? "") && save({ description: e.target.value })}
        placeholder="Description (optional)"
        rows={2}
        className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5 mt-2"
      />

      <textarea
        defaultValue={item.content ?? ""}
        onBlur={(e) => e.target.value !== (item.content ?? "") && save({ content: e.target.value })}
        placeholder="Note content (optional)"
        rows={4}
        className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5 mt-2"
      />

      <input
        defaultValue={item.file_url ?? ""}
        onBlur={(e) => e.target.value !== (item.file_url ?? "") && save({ file_url: e.target.value })}
        placeholder="Link to uploaded file (Drive/PDF/etc)"
        className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5 mt-2"
      />
    </div>
  );
}
