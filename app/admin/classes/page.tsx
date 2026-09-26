"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ClassRow = {
  id: string;
  title: string;
  description: string | null;
  type: "live" | "recorded";
  scheduled_at: string | null;
  duration_minutes: number | null;
  meeting_url: string | null;
  video_url: string | null;
  published: boolean;
  position: number;
  created_at: string;
};

function toLocalInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminClassesPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newType, setNewType] = useState<"live" | "recorded">("live");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [newMeetingUrl, setNewMeetingUrl] = useState("");
  const [newVideoUrl, setNewVideoUrl] = useState("");

  async function loadClasses() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/classes", { headers: { "x-admin-secret": secret } });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setClasses(data.classes ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked) loadClasses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function createClass(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setError(null);
    const res = await fetch("/api/admin/classes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        type: newType,
        scheduled_at: newScheduledAt || undefined,
        duration_minutes: newDuration ? Number(newDuration) : undefined,
        meeting_url: newMeetingUrl.trim() || undefined,
        video_url: newVideoUrl.trim() || undefined,
        position: classes.length,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setNewTitle("");
    setNewDescription("");
    setNewType("live");
    setNewScheduledAt("");
    setNewDuration("");
    setNewMeetingUrl("");
    setNewVideoUrl("");
    loadClasses();
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
          <Link href="/admin/quiz" className="underline text-black/50">
            Quiz
          </Link>
          <span className="font-semibold">Classes</span>
        </div>

        <h1 className="text-2xl font-bold mb-2">Classes</h1>
        <p className="text-sm text-black/60 mb-6">
          Add a live class with its Zoom/Meet link and start time, or a recording with its video link.
          Flip &ldquo;Published&rdquo; on when it&apos;s ready — members only ever see published classes on
          /dashboard/classes, split into Upcoming and Recordings automatically by type and time.
        </p>

        <form onSubmit={createClass} className="bg-white rounded-xl border border-black/10 p-4 mb-6 space-y-2">
          <p className="text-xs font-semibold text-black/50">New class</p>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title, e.g. Week 6: Conditional Sentences Q&A"
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
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as "live" | "recorded")}
              className="rounded-lg border border-black/10 px-3 py-2 text-sm"
            >
              <option value="live">Live (scheduled)</option>
              <option value="recorded">Recorded</option>
            </select>
            <input
              type="datetime-local"
              value={newScheduledAt}
              onChange={(e) => setNewScheduledAt(e.target.value)}
              className="flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={1}
              value={newDuration}
              onChange={(e) => setNewDuration(e.target.value)}
              placeholder="Duration (min)"
              className="w-32 rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
          </div>
          {newType === "live" ? (
            <input
              value={newMeetingUrl}
              onChange={(e) => setNewMeetingUrl(e.target.value)}
              placeholder="Zoom / Google Meet join link"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
          ) : (
            <input
              value={newVideoUrl}
              onChange={(e) => setNewVideoUrl(e.target.value)}
              placeholder="Recording link (YouTube/Drive/etc)"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
          )}
          <button className="rounded-lg px-4 py-2 font-bold text-white bg-[#6FC24A]">Create class</button>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {loading && <p className="text-sm text-black/50 mb-4">Loading…</p>}

        <div className="space-y-4">
          {classes.map((c) => (
            <ClassCard key={c.id} item={c} secret={secret} onChanged={loadClasses} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ClassCard({
  item,
  secret,
  onChanged,
}: {
  item: ClassRow;
  secret: string;
  onChanged: () => void | Promise<void>;
}) {
  async function save(updates: Partial<ClassRow>) {
    await fetch(`/api/admin/classes/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(updates),
    });
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    await fetch(`/api/admin/classes/${item.id}`, {
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
        <select
          value={item.type}
          onChange={(e) => save({ type: e.target.value as "live" | "recorded" })}
          className="rounded-md border border-black/10 px-2 py-1 text-xs shrink-0"
        >
          <option value="live">Live</option>
          <option value="recorded">Recorded</option>
        </select>
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

      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-black/60">
        <span>When:</span>
        <input
          type="datetime-local"
          defaultValue={toLocalInputValue(item.scheduled_at)}
          onBlur={(e) => {
            const v = e.target.value ? new Date(e.target.value).toISOString() : null;
            if (v !== item.scheduled_at) save({ scheduled_at: v ?? undefined });
          }}
          className="rounded-md border border-black/10 px-2 py-1"
        />
        <span>Duration (min):</span>
        <input
          type="number"
          min={1}
          defaultValue={item.duration_minutes ?? ""}
          onBlur={(e) => {
            const v = e.target.value ? Number(e.target.value) : null;
            if (v !== (item.duration_minutes ?? null)) save({ duration_minutes: v ?? undefined });
          }}
          placeholder="—"
          className="w-20 rounded-md border border-black/10 px-2 py-1"
        />
      </div>

      {item.type === "live" ? (
        <input
          defaultValue={item.meeting_url ?? ""}
          onBlur={(e) => e.target.value !== (item.meeting_url ?? "") && save({ meeting_url: e.target.value })}
          placeholder="Zoom / Google Meet join link"
          className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5 mt-2"
        />
      ) : (
        <input
          defaultValue={item.video_url ?? ""}
          onBlur={(e) => e.target.value !== (item.video_url ?? "") && save({ video_url: e.target.value })}
          placeholder="Recording link (YouTube/Drive/etc)"
          className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5 mt-2"
        />
      )}
    </div>
  );
}
