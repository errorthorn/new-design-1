"use client";

import { useState } from "react";
import { UserPlus, KeyRound, Copy, Check, Trash2, Power, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { SearchBox, matchesSearch, EmptyState } from "@/components/admin/ui";
import { ADMIN_SECTIONS, ADMIN_SECTION_LABELS, type AdminSection } from "@/lib/admin-sections";

type Staff = {
  id: string;
  name: string;
  email: string | null;
  user_id: string | null;
  key_hint: string | null;
  sections: AdminSection[];
  active: boolean;
  created_at: string;
  last_used_at: string | null;
};

// Owner-only page: give people admin access and choose which sections each one can use.
//   - By ACCOUNT: type the email of someone who already has a LingoCraft account. They then see
//     "Admin" in their profile menu and need no key. (This is the normal way.)
//   - By KEY: for someone without an account; they paste the key into the admin pages.
// See docs/ADMIN-ACCESS.md.
export default function AdminStaffPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // account form
  const [email, setEmail] = useState("");
  const [acctSections, setAcctSections] = useState<AdminSection[]>([]);
  // key form
  const [name, setName] = useState("");
  const [keySections, setKeySections] = useState<AdminSection[]>([]);

  // A key is shown only once, right after it is created or reissued.
  const [shownKey, setShownKey] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function call(method: string, body?: unknown) {
    const res = await fetch("/api/admin/staff", {
      method,
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return null;
    }
    setError(null);
    return data;
  }

  async function load() {
    const data = await call("GET");
    if (data) {
      setStaff(data.staff ?? []);
      setUnlocked(true);
    }
  }

  function toggle(list: AdminSection[], section: AdminSection) {
    return list.includes(section) ? list.filter((x) => x !== section) : [...list, section];
  }

  async function giveAccess(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const data = await call("POST", { email, sections: acctSections });
    if (!data) return;
    setNotice(`${data.staff.name} can now open Admin from their profile menu.`);
    setEmail("");
    setAcctSections([]);
    load();
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const data = await call("POST", { name, sections: keySections });
    if (!data) return;
    setShownKey({ name: data.staff.name, key: data.key });
    setCopied(false);
    setName("");
    setKeySections([]);
    load();
  }

  async function toggleSection(member: Staff, section: AdminSection) {
    if (await call("PATCH", { id: member.id, sections: toggle(member.sections, section) })) load();
  }

  async function setActive(member: Staff, active: boolean) {
    if (await call("PATCH", { id: member.id, active })) load();
  }

  async function reissue(member: Staff) {
    if (!confirm(`Issue a new key for ${member.name}? Their current key stops working immediately.`)) return;
    const data = await call("PATCH", { id: member.id, regenerateKey: true });
    if (data?.key) {
      setShownKey({ name: member.name, key: data.key });
      setCopied(false);
      load();
    }
  }

  async function remove(member: Staff) {
    if (!confirm(`Remove ${member.name}? They lose admin access immediately.`)) return;
    if (await call("DELETE", { id: member.id })) load();
  }

  const shown = staff.filter((m) => matchesSearch(query, m.name, m.email));
  const box = "rounded-2xl border-2 border-leaf-500 bg-white p-5";
  const input = "w-full rounded-xl border border-leaf-300 px-4 py-3";

  if (!unlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className={`${box} w-full max-w-sm`}
        >
          <label className="mb-1 block text-sm font-medium">Owner key</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className={`${input} mb-4`}
            placeholder="ADMIN_SECRET"
          />
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <button className="w-full rounded-full bg-leaf-600 py-3 font-bold text-white">Enter</button>
        </form>
      </div>
    );
  }

  return (
    <AdminShell current="staff" title="Staff" width="max-w-3xl">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {notice && <p className={`${box} mb-5 py-3 text-sm`}>{notice}</p>}

        {shownKey && (
          <div className={`${box} mb-6`}>
            <p className="mb-1 text-sm font-semibold">Key for {shownKey.name}</p>
            <p className="mb-2 text-xs text-black/60">Copy it now and send it to them. It will not be shown again.</p>
            <code className="mb-3 block break-all rounded-xl border border-leaf-300 bg-white px-3 py-2 text-sm">
              {shownKey.key}
            </code>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(shownKey.key);
                  setCopied(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-leaf-600 px-4 py-2 text-sm font-semibold text-white"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy key"}
              </button>
              <button onClick={() => setShownKey(null)} className="rounded-full border border-leaf-300 px-4 py-2 text-sm">
                Done
              </button>
            </div>
          </div>
        )}

        <form onSubmit={giveAccess} className={`${box} mb-4`}>
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <UserPlus size={17} className="text-leaf-700" />
            Give access to an account
          </h2>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="their-account@email.com"
            className={`${input} mb-3`}
          />
          <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
            {ADMIN_SECTIONS.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={acctSections.includes(s)} onChange={() => setAcctSections((c) => toggle(c, s))} />
                {ADMIN_SECTION_LABELS[s]}
              </label>
            ))}
          </div>
          <button
            disabled={!email.trim() || acctSections.length === 0}
            className="rounded-full bg-leaf-600 px-5 py-2.5 font-bold text-white disabled:opacity-40"
          >
            Give access
          </button>
        </form>

        <details className="mb-8 rounded-2xl border border-leaf-300 bg-white p-5">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <KeyRound size={16} className="text-black/60" />
            Or make an access key (for someone without an account)
          </summary>
          <form onSubmit={createKey} className="mt-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Name"
              className={`${input} mb-3`}
            />
            <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
              {ADMIN_SECTIONS.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={keySections.includes(s)} onChange={() => setKeySections((c) => toggle(c, s))} />
                  {ADMIN_SECTION_LABELS[s]}
                </label>
              ))}
            </div>
            <button
              disabled={!name.trim() || keySections.length === 0}
              className="rounded-full bg-leaf-600 px-5 py-2.5 font-bold text-white disabled:opacity-40"
            >
              Create &amp; show key
            </button>
          </form>
        </details>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold">People with access</h2>
          <SearchBox value={query} onChange={setQuery} placeholder="Search name or email" className="max-w-xs" />
        </div>
        <div className="space-y-4">
          {shown.length === 0 && <EmptyState text={staff.length === 0 ? "No staff yet." : "No match."} />}
          {shown.map((m) => (
            <div key={m.id} className={`${box} ${m.active ? "" : "opacity-60"}`}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {m.name} {!m.active && <span className="text-xs font-normal text-red-600">(off)</span>}
                  </p>
                  <p className="break-all text-xs text-black/50">
                    {m.user_id ? `Account: ${m.email ?? "linked"}` : `Key ends in ${m.key_hint ?? "----"}`} ·{" "}
                    {m.last_used_at ? `last used ${new Date(m.last_used_at).toLocaleString()}` : "never used"}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    onClick={() => setActive(m, !m.active)}
                    className="inline-flex items-center gap-1 rounded-full border border-leaf-300 px-3 py-1.5 text-xs"
                  >
                    <Power size={12} />
                    {m.active ? "Turn off" : "Turn on"}
                  </button>
                  {!m.user_id && (
                    <button
                      onClick={() => reissue(m)}
                      className="inline-flex items-center gap-1 rounded-full border border-leaf-300 px-3 py-1.5 text-xs"
                    >
                      <RefreshCw size={12} />
                      New key
                    </button>
                  )}
                  <button
                    onClick={() => remove(m)}
                    className="inline-flex items-center gap-1 rounded-full border border-red-200 px-3 py-1.5 text-xs text-red-600"
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {ADMIN_SECTIONS.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={m.sections.includes(s)} onChange={() => toggleSection(m, s)} />
                    {ADMIN_SECTION_LABELS[s]}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
    </AdminShell>
  );
}
