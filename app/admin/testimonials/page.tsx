"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Testimonial = {
  id: string;
  name: string;
  role: string | null;
  quote: string;
  avatar_path: string | null;
  avatar_url: string | null;
  rating: number;
  published: boolean;
  position: number;
};

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="text-lg leading-none"
          aria-label={`${n} star`}
        >
          <span className={n <= value ? "text-amber-400" : "text-black/15"}>★</span>
        </button>
      ))}
    </div>
  );
}

export default function AdminTestimonialsPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newQuote, setNewQuote] = useState("");
  const [newRating, setNewRating] = useState(5);
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/testimonials", {
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setItems(data.testimonials ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function addTestimonial(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newQuote.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/testimonials", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({
          name: newName.trim(),
          role: newRole.trim() || undefined,
          quote: newQuote.trim(),
          rating: newRating,
          position: items.length,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setNewName("");
      setNewRole("");
      setNewQuote("");
      setNewRating(5);
      load();
    } finally {
      setAdding(false);
    }
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
        <div className="flex flex-wrap items-center gap-4 text-sm mb-4">
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
          <span className="font-semibold">Testimonials</span>
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

        <h1 className="text-2xl font-bold mb-2">Testimonials</h1>
        <p className="text-sm text-black/60 mb-6">
          Manage the homepage&apos;s &ldquo;Members say&rdquo; section from here. Only <strong>Published</strong>
          testimonials will show on the site; if no photo is given, a badge with the first letter of the name will show instead.
        </p>

        <form onSubmit={addTestimonial} className="bg-white rounded-xl border border-black/10 p-4 mb-6 space-y-2">
          <p className="text-xs font-semibold text-black/50">Add new testimonial</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name, e.g. Priya S."
            className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
          />
          <input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="Role (optional), e.g. Software engineer"
            className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
          />
          <textarea
            value={newQuote}
            onChange={(e) => setNewQuote(e.target.value)}
            placeholder="Quote"
            rows={2}
            className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-black/50">Rating:</span>
            <StarPicker value={newRating} onChange={setNewRating} />
          </div>
          <button disabled={adding} className="rounded-lg px-4 py-2 text-sm font-bold text-white bg-[#6FC24A] disabled:opacity-60">
            Add
          </button>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {loading && <p className="text-sm text-black/50 mb-4">Loading…</p>}

        <div className="space-y-3">
          {items.map((item) => (
            <TestimonialRow key={item.id} item={item} secret={secret} onChanged={load} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TestimonialRow({
  item,
  secret,
  onChanged,
}: {
  item: Testimonial;
  secret: string;
  onChanged: () => void | Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function save(updates: Partial<Pick<Testimonial, "name" | "role" | "quote" | "rating" | "published" | "position">>) {
    await fetch(`/api/admin/testimonials/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(updates),
    });
    onChanged();
  }

  async function remove() {
    if (!confirm(`This will delete the testimonial for "${item.name}" — are you sure?`)) return;
    await fetch(`/api/admin/testimonials/${item.id}`, {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    onChanged();
  }

  async function uploadPhoto(file: File) {
    setUploading(true);
    setError(null);
    try {
      const urlRes = await fetch(
        `/api/admin/testimonials/upload-url?testimonialId=${item.id}&fileName=${encodeURIComponent(file.name)}`,
        { headers: { "x-admin-secret": secret } }
      );
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error ?? "Upload URL failed");

      const { error: uploadError } = await supabaseBrowser.storage
        .from("testimonial-avatars")
        .uploadToSignedUrl(urlData.path, urlData.token, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const confirmRes = await fetch("/api/admin/testimonials/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ testimonialId: item.id, path: urlData.path }),
      });
      if (!confirmRes.ok) throw new Error("Upload confirm failed");

      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-4">
      <div className="flex items-start gap-3">
        <label className="shrink-0 cursor-pointer">
          {item.avatar_url ? (
            <img
              src={item.avatar_url}
              alt={item.name}
              className="h-14 w-14 rounded-full object-cover border border-black/10"
            />
          ) : (
            <div className="h-14 w-14 rounded-full border border-black/10 bg-[#6FC24A]/20 flex items-center justify-center text-sm font-bold text-[#2E6B2A]">
              {item.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadPhoto(file);
              e.target.value = "";
            }}
          />
          <span className="mt-1 block text-center text-[10px] text-black/50">
            {uploading ? "…" : "Change photo"}
          </span>
        </label>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              defaultValue={item.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== item.name && save({ name: e.target.value.trim() })}
              className="font-semibold flex-1 min-w-0 rounded-md border border-transparent hover:border-black/10 focus:border-black/20 px-2 py-1 -ml-2"
            />
            <label className="flex items-center gap-1.5 text-xs text-black/60 shrink-0">
              <input
                type="checkbox"
                checked={item.published}
                onChange={(e) => save({ published: e.target.checked })}
              />
              Published
            </label>
            <button onClick={remove} className="text-xs text-red-600 underline shrink-0">
              Delete
            </button>
          </div>

          <input
            defaultValue={item.role ?? ""}
            onBlur={(e) => e.target.value !== (item.role ?? "") && save({ role: e.target.value })}
            placeholder="Role"
            className="w-full text-sm text-black/60 rounded-md border border-transparent hover:border-black/10 focus:border-black/20 px-2 py-1 -ml-2"
          />

          <textarea
            defaultValue={item.quote}
            onBlur={(e) => e.target.value.trim() && e.target.value !== item.quote && save({ quote: e.target.value.trim() })}
            rows={2}
            className="w-full text-sm rounded-md border border-black/10 px-2 py-1.5"
          />

          <div className="flex items-center gap-2">
            <span className="text-xs text-black/50">Rating:</span>
            <StarPicker value={item.rating} onChange={(v) => save({ rating: v })} />
          </div>

          {/* Lower number shows first in the carousel order */}
          <div className="flex items-center gap-1.5 text-xs text-black/50">
            <span>Order:</span>
            <input
              type="number"
              defaultValue={item.position}
              onBlur={(e) => Number(e.target.value) !== item.position && save({ position: Number(e.target.value) || 0 })}
              className="w-16 rounded-md border border-black/10 px-2 py-1"
            />
          </div>

          {error && <p className="text-red-600 text-xs">{error}</p>}
        </div>
      </div>
    </div>
  );
}
