"use client";

import { useEffect, useState } from "react";
import { GraduationCap, Clock, Radio, PlayCircle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccessGate } from "@/components/dashboard/access-gate";

type ClassItem = {
  id: string;
  title: string;
  description: string | null;
  type: "live" | "recorded";
  scheduled_at: string | null;
  duration_minutes: number | null;
  meeting_url: string | null;
  video_url: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "unauthorized"; message: string }
  | { status: "forbidden"; message: string; requiresPlan?: string }
  | { status: "error"; message: string }
  | { status: "ready"; upcoming: ClassItem[]; past: ClassItem[]; recordings: ClassItem[] };

function formatWhen(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// A join link only makes sense once the session is close — this keeps a
// class listed under "Upcoming" all week but the actual Join button only
// appears starting 15 minutes before start, through 90 minutes after (in
// case admin/student time drifts or the class runs a bit late).
function isJoinWindow(iso: string | null) {
  if (!iso) return true;
  const start = new Date(iso).getTime();
  const now = Date.now();
  return now >= start - 15 * 60_000 && now <= start + 90 * 60_000;
}

export default function ClassesPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/classes")
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
          setState({
            status: "ready",
            upcoming: data.upcoming ?? [],
            past: data.past ?? [],
            recordings: data.recordings ?? [],
          });
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
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
        Problem Solving Classes
      </h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Live sessions to join, and recordings of every class you&apos;ve missed or want to revisit.
      </p>

      <div className="mt-6">
        {state.status === "loading" && (
          <p className="font-body text-sm text-ink-soft dark:text-cream/50">Loading…</p>
        )}

        {(state.status === "unauthorized" || state.status === "forbidden" || state.status === "error") && (
          <AccessGate
            status={state.status}
            message={state.message}
            icon={GraduationCap}
            requiresPlan={state.status === "forbidden" ? state.requiresPlan : undefined}
          />
        )}

        {state.status === "ready" && (
          <div className="space-y-8">
            <Section
              icon={<Radio size={16} />}
              title="Upcoming live classes"
              empty="No live class scheduled right now — check back soon."
            >
              {state.upcoming.map((c) => (
                <LiveCard key={c.id} item={c} />
              ))}
            </Section>

            <Section
              icon={<PlayCircle size={16} />}
              title="Recordings"
              empty="No recordings uploaded yet."
            >
              {state.recordings.map((c) => (
                <RecordingCard key={c.id} item={c} />
              ))}
            </Section>

            {state.past.length > 0 && (
              <Section icon={<Clock size={16} />} title="Past sessions" empty="">
                {state.past.map((c) => (
                  <LiveCard key={c.id} item={c} pastOnly />
                ))}
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  empty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 font-body text-sm font-semibold text-ink-soft dark:text-cream/70">
        {icon}
        {title}
      </div>
      {children.length === 0 ? (
        empty ? (
          <p className="rounded-xl border border-dashed border-ink/15 bg-cream-soft px-4 py-6 text-center font-body text-sm text-ink-soft dark:border-night-border dark:bg-night-soft dark:text-cream/50">
            {empty}
          </p>
        ) : null
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
      )}
    </div>
  );
}

function LiveCard({ item, pastOnly = false }: { item: ClassItem; pastOnly?: boolean }) {
  const when = formatWhen(item.scheduled_at);
  const joinable = !pastOnly && item.meeting_url && isJoinWindow(item.scheduled_at);

  return (
    <div className="flex flex-col rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft">
      <p className="font-display text-base font-semibold leading-snug">{item.title}</p>
      {item.description && (
        <p className="mt-1.5 font-body text-sm text-ink-soft dark:text-cream/60">{item.description}</p>
      )}
      <div className="mt-4 flex items-center gap-3 font-body text-xs text-ink-soft/70 dark:text-cream/40">
        {when && (
          <span className="flex items-center gap-1">
            <Clock size={13} /> {when}
          </span>
        )}
        {item.duration_minutes && <span>{item.duration_minutes} min</span>}
      </div>
      <div className="mt-4">
        {joinable ? (
          <a
            href={item.meeting_url!}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-pill bg-leaf-500 px-3.5 py-1.5 font-body text-xs font-semibold text-white hover:bg-leaf-600"
            )}
          >
            Join class <ExternalLink size={13} />
          </a>
        ) : pastOnly ? (
          <span className="inline-flex items-center rounded-pill border border-ink/15 px-3 py-1 font-body text-xs font-medium text-ink-soft dark:border-night-border dark:text-cream/50">
            Ended
          </span>
        ) : (
          <span className="inline-flex items-center rounded-pill border border-ink/15 px-3 py-1 font-body text-xs font-medium text-ink-soft dark:border-night-border dark:text-cream/50">
            Join link opens closer to start time
          </span>
        )}
      </div>
    </div>
  );
}

function RecordingCard({ item }: { item: ClassItem }) {
  const when = formatWhen(item.scheduled_at);
  return (
    <div className="flex flex-col rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft">
      <p className="font-display text-base font-semibold leading-snug">{item.title}</p>
      {item.description && (
        <p className="mt-1.5 font-body text-sm text-ink-soft dark:text-cream/60">{item.description}</p>
      )}
      <div className="mt-4 flex items-center gap-3 font-body text-xs text-ink-soft/70 dark:text-cream/40">
        {when && <span>{when}</span>}
        {item.duration_minutes && <span>{item.duration_minutes} min</span>}
      </div>
      <div className="mt-4">
        {item.video_url ? (
          <a
            href={item.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-pill bg-leaf-500 px-3.5 py-1.5 font-body text-xs font-semibold text-white hover:bg-leaf-600"
          >
            Watch recording <ExternalLink size={13} />
          </a>
        ) : (
          <span className="font-body text-xs text-ink-soft/60 dark:text-cream/40">Recording coming soon</span>
        )}
      </div>
    </div>
  );
}
