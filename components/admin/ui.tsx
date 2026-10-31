"use client";

// Small building blocks shared by every admin page, so staff get one consistent, plain
// environment. Styling follows the website (white surfaces, green borders/buttons, Lora headings).

import { Search, X } from "lucide-react";

export const adminCard = "rounded-2xl border border-leaf-300 bg-white";
export const adminInput =
  "w-full rounded-xl border border-leaf-300 bg-white px-3.5 py-2.5 font-body text-sm text-ink placeholder:text-ink-soft/50 focus:border-leaf-600 focus:outline-none";
export const adminBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-pill bg-leaf-600 px-4 py-2 font-body text-sm font-semibold text-white transition-colors hover:bg-leaf-700 disabled:opacity-50";
export const adminBtnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-pill border border-leaf-300 bg-white px-4 py-2 font-body text-sm font-medium text-ink transition-colors hover:border-leaf-600 disabled:opacity-50";

/** Search field used above every list. Controlled; shows a clear button when it has text. */
export function SearchBox({
  value,
  onChange,
  placeholder = "Search",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative w-full ${className}`}>
      <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft/50" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-pill border border-leaf-300 bg-white pl-10 pr-9 font-body text-sm text-ink placeholder:text-ink-soft/50 focus:border-leaf-600 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-soft/60 hover:text-ink"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/** Lower-cased "haystack" match: every word typed must appear somewhere in the given fields. */
export function matchesSearch(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields
    .map((f) => (f === null || f === undefined ? "" : String(f)))
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function EmptyState({ text }: { text: string }) {
  return <p className="py-10 text-center font-body text-sm text-ink-soft/60">{text}</p>;
}

export function Loading() {
  return <p className="py-6 text-center font-body text-sm text-ink-soft/60">Loading…</p>;
}

export function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="mb-3 font-body text-sm text-red-600">{text}</p>;
}
