"use client";

// Assign a whole group to Speaking Club rooms.
//
// Pick a group, then in each of the three shift columns click students one after another: the 1st and 2nd click
// make pair 1, the 3rd and 4th make pair 2, and so on. Each pair gets its own room (the server picks the next empty
// room of that shift when you press Save). A student chosen in one shift disappears from the other two columns.
// Nothing is written until "Save all"; a draft is kept in this browser so a refresh doesn't lose the clicking.

import { AdminShell } from "@/components/admin/admin-shell";
import { AdminChecking } from "@/components/admin/admin-nav";
import { useAdminSession } from "@/hooks/use-admin-access";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Search, X, CheckCircle2 } from "lucide-react";

type Member = { email: string; name: string | null; active: boolean; seated: { room_code: string; shift_number: number } | null };
type Group = { name: string; n: number };
type Picks = { 1: string[]; 2: string[]; 3: string[] };
const EMPTY: Picks = { 1: [], 2: [], 3: [] };
const SHIFTS = [1, 2, 3] as const;
type ShiftNo = (typeof SHIFTS)[number];

const draftKey = (g: string) => `lc-group-assign-draft:${g}`;

export default function GroupAssignPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const adminSession = useAdminSession("speaking-club");
  useEffect(() => {
    if (adminSession.allowed) setUnlocked(true);
  }, [adminSession.allowed]);

  const [groups, setGroups] = useState<Group[]>([]);
  const [group, setGroup] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [times, setTimes] = useState<Record<number, { start: string; end: string }>>({});
  const [picks, setPicks] = useState<Picks>(EMPTY);
  const [query, setQuery] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [result, setResult] = useState<{ done: number; failed: string[] } | null>(null);
  const loadedGroup = useRef("");

  const headers = useMemo(() => ({ "Content-Type": "application/json", "x-admin-secret": secret }), [secret]);

  async function load(g: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/speaking-club/group-assign?group=${encodeURIComponent(g)}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load");
      setGroups(data.groups ?? []);
      setTimes(data.times ?? {});
      setMembers(data.members ?? []);
      loadedGroup.current = g;
      // restore draft (only people still unassigned)
      let restored: Picks = { 1: [], 2: [], 3: [] };
      if (g) {
        try {
          const raw = window.localStorage.getItem(draftKey(g));
          if (raw) {
            const d = JSON.parse(raw) as Picks;
            const free = new Set((data.members as Member[]).filter((m) => !m.seated).map((m) => m.email));
            const seen = new Set<string>();
            for (const n of SHIFTS) {
              restored[n] = (d[n] ?? []).filter((e) => free.has(e) && !seen.has(e) && (seen.add(e), true));
            }
          }
        } catch {
          /* no draft */
        }
      }
      setPicks(restored);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked) load(group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, group]);

  // keep the draft
  useEffect(() => {
    if (!group || loadedGroup.current !== group) return;
    try {
      window.localStorage.setItem(draftKey(group), JSON.stringify(picks));
    } catch {
      /* ignore */
    }
  }, [picks, group]);

  const byEmail = useMemo(() => new Map(members.map((m) => [m.email, m])), [members]);
  const chosen = useMemo(() => new Set([...picks[1], ...picks[2], ...picks[3]]), [picks]);
  const seatedMembers = members.filter((m) => m.seated);
  const pool = members.filter((m) => !m.seated && !chosen.has(m.email));

  const q = query.trim().toLowerCase();
  const matches = (m: Member) => !q || m.email.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q);
  const visiblePool = pool.filter(matches);

  // Suggestions: people whose name or email STARTS with what was typed first, then the ones that merely contain it.
  const suggestions = useMemo(() => {
    if (!q) return [];
    const starts: Member[] = [];
    const contains: Member[] = [];
    for (const m of pool) {
      const hay = [m.email.toLowerCase(), (m.name ?? "").toLowerCase()];
      if (hay.some((h) => h.startsWith(q) || h.split(/\s+/).some((w) => w.startsWith(q)))) starts.push(m);
      else if (hay.some((h) => h.includes(q))) contains.push(m);
    }
    return [...starts, ...contains].slice(0, 8);
  }, [q, pool]);

  function pick(n: ShiftNo, email: string) {
    setResult(null);
    setPicks((p) => ({ ...p, [n]: [...p[n], email] }));
  }
  function unpick(n: ShiftNo, email: string) {
    setPicks((p) => ({ ...p, [n]: p[n].filter((e) => e !== email) }));
  }
  function clearShift(n: ShiftNo) {
    setPicks((p) => ({ ...p, [n]: [] }));
  }

  const total = chosen.size;
  const odd = SHIFTS.filter((n) => picks[n].length % 2 === 1);

  async function post(payload: unknown) {
    const res = await fetch("/api/admin/speaking-club/group-assign", { method: "POST", headers, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Something went wrong");
    return data;
  }

  async function saveAll() {
    if (!total) return;
    const pairs = SHIFTS.reduce((s, n) => s + Math.ceil(picks[n].length / 2), 0);
    const oddNote = odd.length
      ? `\n\nShift ${odd.join(", ")} has one student left without a partner — that student will be alone in the room.`
      : "";
    if (!window.confirm(`Save ${total} students in ${pairs} rooms? Each student gets their room passkey in the bell.${oddNote}`)) return;
    setError(null);
    setResult(null);
    setSaving("Finding rooms…");
    try {
      const plan = await post({ action: "plan", shifts: picks });
      const rows = plan.rows as { shiftId: string; roomCode: string; shiftNumber: number; username1: string; username2: string | null }[];
      let done = 0;
      const failed: string[] = [];
      for (let i = 0; i < rows.length; i += 10) {
        setSaving(`Saving ${Math.min(i + 10, rows.length)} / ${rows.length} rooms…`);
        const r = await post({ action: "apply", rows: rows.slice(i, i + 10) });
        done += r.done;
        for (const f of r.failed) failed.push(`${f.roomCode} shift ${f.shiftNumber}: ${f.error}`);
      }
      setResult({ done, failed });
      try {
        window.localStorage.removeItem(draftKey(group));
      } catch {
        /* ignore */
      }
      await load(group);
      setPicks(EMPTY);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  if (!unlocked && adminSession.checking) return <AdminChecking />;
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
          <button className="w-full rounded-full py-3 font-bold text-white bg-leaf-600">Enter</button>
        </form>
      </div>
    );
  }

  const nameOf = (e: string) => byEmail.get(e)?.name || e;

  return (
    <AdminShell current="speaking-club" title="Assign a group" width="max-w-6xl">
      <Link href="/admin/speaking-club" className="mb-4 inline-flex items-center gap-1 text-sm text-black/50 hover:text-black">
        <ArrowLeft size={14} /> Speaking Club
      </Link>

      {/* Group + search */}
      <div className="mb-5 rounded-2xl border border-leaf-300 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="rounded-xl border border-leaf-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Choose a group…</option>
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name} ({g.n})
              </option>
            ))}
          </select>

          <div className="relative min-w-[240px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/40" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggest(true);
              }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
              disabled={!group}
              placeholder="Type a name or email…"
              className="w-full rounded-xl border border-leaf-300 py-2 pl-9 pr-8 text-sm disabled:bg-black/5"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-black/40" aria-label="Clear">
                <X size={14} />
              </button>
            )}
            {showSuggest && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-leaf-300 bg-white shadow-lg">
                {suggestions.map((m) => (
                  <button
                    key={m.email}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setQuery(m.email);
                      setShowSuggest(false);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-leaf-100"
                  >
                    <span className="font-medium">{m.name || "(no name)"}</span>
                    <span className="block text-xs text-black/50">{m.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={saveAll}
            disabled={!total || !!saving}
            className="rounded-full bg-leaf-600 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ?? `Save all (${total})`}
          </button>
        </div>
        {group && (
          <p className="mt-3 text-xs text-black/50">
            {members.length} in this group · {seatedMembers.length} already have a room · {pool.length} left to place ·{" "}
            {total} chosen now. Click a student in a shift: the 1st &amp; 2nd click make one room, the 3rd &amp; 4th the next, and so on.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {result && (
          <div className="mt-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-leaf-700">
              <CheckCircle2 size={16} /> {result.done} rooms saved.
            </p>
            {result.failed.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-red-600">
                {result.failed.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!group && <p className="text-sm text-black/50">Choose a group to start. Groups are created on the Members page.</p>}
      {loading && <p className="flex items-center gap-2 text-sm text-black/50"><Loader2 size={14} className="animate-spin" /> Loading…</p>}

      {group && !loading && (
        <div className="grid gap-4 lg:grid-cols-3">
          {SHIFTS.map((n) => {
            const list = picks[n];
            const pairs: string[][] = [];
            for (let i = 0; i < list.length; i += 2) pairs.push(list.slice(i, i + 2));
            return (
              <section key={n} className="flex min-h-0 flex-col rounded-2xl border border-leaf-300 bg-white">
                <header className="flex items-center justify-between gap-2 border-b border-leaf-300 px-4 py-3">
                  <div>
                    <h2 className="font-semibold">Shift {n}</h2>
                    {times[n] && <p className="text-xs text-black/40">{times[n].start}–{times[n].end}</p>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-black/50">
                    {list.length} students · {pairs.length} rooms
                    {list.length > 0 && (
                      <button onClick={() => clearShift(n)} className="rounded-full border border-black/10 px-2 py-0.5 hover:bg-black/5">
                        Clear
                      </button>
                    )}
                  </div>
                </header>

                {/* chosen pairs */}
                {pairs.length > 0 && (
                  <div className="max-h-56 overflow-y-auto border-b border-leaf-300 bg-leaf-100/50 px-3 py-2">
                    {pairs.map((pair, i) => (
                      <div key={i} className="mb-1.5 rounded-lg border border-leaf-300 bg-white px-2 py-1.5 text-xs last:mb-0">
                        <p className="mb-0.5 font-semibold text-leaf-700">
                          Room {i + 1}
                          {pair.length === 1 && <span className="ml-1 font-normal text-amber-600">· waiting for partner</span>}
                        </p>
                        {pair.map((e) => (
                          <div key={e} className="flex items-center justify-between gap-2">
                            <span className="truncate">
                              {nameOf(e)} <span className="text-black/40">{byEmail.get(e)?.name ? e : ""}</span>
                            </span>
                            <button onClick={() => unpick(n, e)} className="shrink-0 text-black/40 hover:text-red-600" aria-label="Remove">
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* everyone still free — click to add */}
                <div className="max-h-[420px] overflow-y-auto">
                  {visiblePool.length === 0 ? (
                    <p className="px-4 py-6 text-center text-xs text-black/40">
                      {pool.length === 0 ? "Everyone is placed 🎉" : "No match"}
                    </p>
                  ) : (
                    visiblePool.map((m) => (
                      <button
                        key={m.email}
                        onClick={() => pick(n, m.email)}
                        className="block w-full border-b border-black/5 px-4 py-2 text-left text-sm last:border-0 hover:bg-leaf-100"
                      >
                        <span className="font-medium">{m.name || "(no name)"}</span>
                        {!m.active && <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">inactive</span>}
                        <span className="block truncate text-xs text-black/50">{m.email}</span>
                      </button>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {group && seatedMembers.length > 0 && (
        <details className="mt-5 rounded-2xl border border-leaf-300 bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">Already have a room ({seatedMembers.length})</summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-black/60 sm:grid-cols-2">
            {seatedMembers.map((m) => (
              <li key={m.email} className="truncate">
                {m.name || m.email} — {m.seated!.room_code} · Shift {m.seated!.shift_number}
              </li>
            ))}
          </ul>
        </details>
      )}
    </AdminShell>
  );
}
