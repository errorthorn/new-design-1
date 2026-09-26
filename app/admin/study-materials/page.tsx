"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Item = {
  id: string;
  box_id: string;
  title: string;
  body: string | null;
  video_url: string | null;
  file_path: string | null;
  file_name: string | null;
  published: boolean;
  position: number;
};

type Box = {
  id: string;
  title: string;
  type: string;
  position: number;
  items: Item[];
};

const TYPE_LABELS: Record<string, string> = {
  vocabulary: "Vocabulary",
  class: "Class (recorded + slides)",
  resource: "Free resource",
};

export default function AdminStudyMaterialsPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newBoxTitle, setNewBoxTitle] = useState("");
  const [newBoxType, setNewBoxType] = useState("vocabulary");

  async function loadBoxes() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/material-boxes", {
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setBoxes(data.boxes ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked) loadBoxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function createBox(e: React.FormEvent) {
    e.preventDefault();
    if (!newBoxTitle.trim()) return;
    setError(null);
    const res = await fetch("/api/admin/material-boxes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ title: newBoxTitle.trim(), type: newBoxType, position: boxes.length }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setNewBoxTitle("");
    loadBoxes();
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
        <div className="flex items-center gap-4 text-sm mb-4">
          <Link href="/admin/questions" className="underline text-black/50">
            Questions
          </Link>
          <Link href="/admin/members" className="underline text-black/50">
            Members
          </Link>
          <Link href="/admin/scoring" className="underline text-black/50">
            Scoring
          </Link>
          <span className="font-semibold">Study Materials</span>
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

        <h1 className="text-2xl font-bold mb-2">Study Materials</h1>
        <p className="text-sm text-black/60 mb-6">
          Create a box (e.g. Vocabulary, Class, Resource), then add items week by week
          inside it — text, a class link, or a PDF upload. Only published items
          will be visible to members on the /study-materials page.
        </p>

        <form onSubmit={createBox} className="bg-white rounded-xl border border-black/10 p-4 mb-6 flex gap-2 flex-wrap">
          <input
            value={newBoxTitle}
            onChange={(e) => setNewBoxTitle(e.target.value)}
            placeholder="New box name, e.g. Daily Topic Vocabulary"
            className="flex-1 min-w-[200px] rounded-lg border border-black/10 px-3 py-2"
          />
          <select
            value={newBoxType}
            onChange={(e) => setNewBoxType(e.target.value)}
            className="rounded-lg border border-black/10 px-3 py-2"
          >
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="rounded-lg px-4 py-2 font-bold text-white bg-[#6FC24A]">Create Box</button>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {loading && <p className="text-sm text-black/50 mb-4">Loading…</p>}

        <div className="space-y-6">
          {boxes.map((box) => (
            <BoxCard key={box.id} box={box} secret={secret} onChanged={loadBoxes} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BoxCard({
  box,
  secret,
  onChanged,
}: {
  box: Box;
  secret: string;
  onChanged: () => void | Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemBody, setNewItemBody] = useState("");
  const [newItemVideo, setNewItemVideo] = useState("");
  const [adding, setAdding] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  async function saveBox(updates: Partial<Pick<Box, "title" | "type">>) {
    await fetch(`/api/admin/material-boxes/${box.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(updates),
    });
    onChanged();
  }

  async function deleteBox() {
    if (!confirm(`This will delete the box "${box.title}" and all its items — are you sure?`)) return;
    await fetch(`/api/admin/material-boxes/${box.id}`, {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    onChanged();
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemTitle.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/material-items", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({
          box_id: box.id,
          title: newItemTitle.trim(),
          body: newItemBody.trim() || undefined,
          video_url: newItemVideo.trim() || undefined,
          position: box.items.length,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setNewItemTitle("");
      setNewItemBody("");
      setNewItemVideo("");
      onChanged();
    } finally {
      setAdding(false);
    }
  }

  async function saveItem(itemId: string, updates: Partial<Pick<Item, "title" | "body" | "video_url" | "published">>) {
    await fetch(`/api/admin/material-items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(updates),
    });
    onChanged();
  }

  async function deleteItem(itemId: string) {
    if (!confirm("This item will be deleted — are you sure?")) return;
    await fetch(`/api/admin/material-items/${itemId}`, {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    onChanged();
  }

  async function uploadFile(itemId: string, file: File) {
    setUploadingId(itemId);
    setError(null);
    try {
      const urlRes = await fetch(
        `/api/admin/material-items/upload-url?itemId=${itemId}&fileName=${encodeURIComponent(file.name)}`,
        { headers: { "x-admin-secret": secret } }
      );
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error ?? "Upload URL failed");

      const { error: uploadError } = await supabaseBrowser.storage
        .from("study-materials")
        .uploadToSignedUrl(urlData.path, urlData.token, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const confirmRes = await fetch("/api/admin/material-items/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ itemId, path: urlData.path, fileName: file.name }),
      });
      if (!confirmRes.ok) throw new Error("Upload confirm failed");

      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <input
          defaultValue={box.title}
          onBlur={(e) => e.target.value.trim() && e.target.value !== box.title && saveBox({ title: e.target.value.trim() })}
          className="font-bold text-lg flex-1 rounded-lg border border-transparent hover:border-black/10 focus:border-black/20 px-2 py-1 -ml-2"
        />
        <select
          defaultValue={box.type}
          onChange={(e) => saveBox({ type: e.target.value })}
          className="text-sm rounded-lg border border-black/10 px-2 py-1"
        >
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button onClick={deleteBox} className="text-sm text-red-600 underline">
          Delete Box
        </button>
      </div>

      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}

      <div className="mt-4 space-y-3">
        {box.items.map((item) => (
          <div key={item.id} className="rounded-lg border border-black/10 p-3">
            <div className="flex items-center gap-2 mb-2">
              <input
                defaultValue={item.title}
                onBlur={(e) => e.target.value.trim() && e.target.value !== item.title && saveItem(item.id, { title: e.target.value.trim() })}
                className="font-semibold flex-1 rounded-md border border-transparent hover:border-black/10 focus:border-black/20 px-2 py-1 -ml-2"
                placeholder="e.g. Week 3 — Travel"
              />
              <label className="flex items-center gap-1.5 text-xs text-black/60 shrink-0">
                <input
                  type="checkbox"
                  checked={item.published}
                  onChange={(e) => saveItem(item.id, { published: e.target.checked })}
                />
                Published
              </label>
              <button onClick={() => deleteItem(item.id)} className="text-xs text-red-600 underline shrink-0">
                Delete
              </button>
            </div>

            <textarea
              defaultValue={item.body ?? ""}
              onBlur={(e) => e.target.value !== (item.body ?? "") && saveItem(item.id, { body: e.target.value })}
              placeholder="Vocabulary / notes (text)"
              rows={2}
              className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5 mb-2"
            />

            <input
              defaultValue={item.video_url ?? ""}
              onBlur={(e) => e.target.value !== (item.video_url ?? "") && saveItem(item.id, { video_url: e.target.value })}
              placeholder="Recorded class link (YouTube/Drive)"
              className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5 mb-2"
            />

            <div className="flex items-center gap-2 text-xs">
              <label className="rounded-md border border-black/10 px-2 py-1 cursor-pointer hover:bg-black/5">
                {uploadingId === item.id ? "Uploading…" : item.file_name ? "Replace PDF" : "Upload PDF"}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={uploadingId === item.id}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadFile(item.id, file);
                    e.target.value = "";
                  }}
                />
              </label>
              {item.file_name && <span className="text-black/50">{item.file_name}</span>}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={addItem} className="mt-4 border-t border-black/10 pt-4 space-y-2">
        <p className="text-xs font-semibold text-black/50">Add new item</p>
        <input
          value={newItemTitle}
          onChange={(e) => setNewItemTitle(e.target.value)}
          placeholder="Title, e.g. Week 4 — Job Interviews"
          className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
        />
        <textarea
          value={newItemBody}
          onChange={(e) => setNewItemBody(e.target.value)}
          placeholder="Vocabulary / notes (optional)"
          rows={2}
          className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
        />
        <input
          value={newItemVideo}
          onChange={(e) => setNewItemVideo(e.target.value)}
          placeholder="Recorded class link (optional)"
          className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
        />
        <button disabled={adding} className="rounded-lg px-4 py-2 text-sm font-bold text-white bg-[#6FC24A] disabled:opacity-60">
          Add Item
        </button>
        <p className="text-xs text-black/40">The PDF upload option will appear inside the item once it&apos;s created.</p>
      </form>
    </div>
  );
}
