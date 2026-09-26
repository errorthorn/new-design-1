"use client";

import { useEffect, useState } from "react";
import { NotebookText, FileText, ExternalLink } from "lucide-react";
import { AccessGate } from "@/components/dashboard/access-gate";

type NoteItem = {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  file_url: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "unauthorized"; message: string }
  | { status: "forbidden"; message: string; requiresPlan?: string }
  | { status: "error"; message: string }
  | { status: "ready"; notes: NoteItem[] };

export default function ClassNotesPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/class-notes")
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "unauthorized", message: data.error ?? "Please log in first." });
        } else if (res.status === 403) {
          setState({ status: "forbidden", message: data.error ?? "Subscription is not active.", requiresPlan: data.requiresPlan });
        } else if (!res.ok) {
          setState({ status: "error", message: data.error ?? "Something went wrong." });
        } else {
          setState({ status: "ready", notes: data.notes ?? [] });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Something went wrong." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Class Notes</h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Notes and materials from your classes.
      </p>

      <div className="mt-6">
        {state.status === "loading" && (
          <p className="font-body text-sm text-ink-soft dark:text-cream/50">Loading…</p>
        )}

        {(state.status === "unauthorized" || state.status === "forbidden" || state.status === "error") && (
          <AccessGate
            status={state.status}
            message={state.message}
            icon={NotebookText}
            requiresPlan={state.status === "forbidden" ? state.requiresPlan : undefined}
          />
        )}

        {state.status === "ready" &&
          (state.notes.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink/15 bg-cream-soft px-4 py-6 text-center font-body text-sm text-ink-soft dark:border-night-border dark:bg-night-soft dark:text-cream/50">
              No notes uploaded yet — check back soon.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {state.notes.map((note) => (
                <NoteCard key={note.id} item={note} />
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

function NoteCard({ item }: { item: NoteItem }) {
  return (
    <div className="flex flex-col rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft">
      <p className="font-display text-base font-semibold leading-snug">{item.title}</p>
      {item.description && (
        <p className="mt-1.5 font-body text-sm text-ink-soft dark:text-cream/60">{item.description}</p>
      )}
      {item.content && (
        <p className="mt-3 whitespace-pre-wrap font-body text-sm text-ink-soft dark:text-cream/70">
          {item.content}
        </p>
      )}
      {item.file_url && (
        <div className="mt-4">
          <a
            href={item.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-pill bg-leaf-500 px-3.5 py-1.5 font-body text-xs font-semibold text-white hover:bg-leaf-600"
          >
            <FileText size={13} /> Open material <ExternalLink size={13} />
          </a>
        </div>
      )}
    </div>
  );
}
