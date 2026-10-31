"use client";

// "Paste from AI" box for /admin/vocab-words. The admin asks any AI for words in the fixed format
// (the prompt is one click away), pastes the answer, and sees every word laid out the way the student
// page will show it: pronunciation, part of speech, meaning, synonyms, examples with their Bangla.
// Problems are marked on the word they belong to, and nothing is saved until the admin presses Add.
import { useEffect, useMemo, useState } from "react";
import { MAX_IMPORT_WORDS, VOCAB_SAMPLE_BLOCK, buildVocabPrompt, parseVocabText, type ParsedVocab } from "@/lib/vocab-import";

type Props = {
  secret: string;
  /** Words already in the database (any case), to flag repeats. */
  existingWords: string[];
  existingTopics: string[];
  onAdded: () => void;
};

const inputCls = "w-full rounded-xl border border-leaf-300 px-3 py-2 text-sm";

export function VocabBulkImport({ secret, existingWords, existingTopics, onAdded }: Props) {
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [date, setDate] = useState("");
  const [count, setCount] = useState(10);
  const [override, setOverride] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(() => parseVocabText(text), [text]);
  const existing = useMemo(() => new Set(existingWords.map((w) => w.trim().toLowerCase())), [existingWords]);

  // Topic / Date lines at the top of the pasted text fill the boxes, unless the admin already typed there.
  useEffect(() => {
    if (parsed.topic && !topic) setTopic(parsed.topic);
    if (parsed.date && !date) setDate(parsed.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.topic, parsed.date]);

  // A new paste starts with fresh checkbox choices.
  useEffect(() => setOverride({}), [text]);

  const rows = parsed.items.map((item, i) => {
    const exists = existing.has(item.draft.word.toLowerCase());
    const blocked = item.errors.length > 0;
    const defaultOn = !blocked && !item.duplicateInPaste && !exists;
    const on = blocked ? false : override[i] ?? defaultOn;
    return { item, exists, blocked, on };
  });
  const chosen = rows.filter((r) => r.on);
  const needFix = rows.filter((r) => r.blocked).length;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildVocabPrompt({ count, topic, date }));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ kind: "error", text: "Could not copy automatically. Open “Show the prompt” below and copy it by hand." });
    }
  }

  async function add() {
    if (chosen.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/vocab-words/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ words: chosen.map((r) => r.item.draft), dailyDate: date || null, topic: topic || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ kind: "error", text: data.error ?? "Something went wrong. Nothing was added." });
        return;
      }
      setMessage({ kind: "ok", text: `Added ${data.inserted} word${data.inserted === 1 ? "" : "s"}.` });
      setText("");
      onAdded();
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Nothing was added." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl p-6 border border-leaf-300 mb-8 space-y-4">
      <div>
        <h2 className="font-semibold">Add many words at once (paste from AI)</h2>
        <ol className="mt-1 list-decimal pl-5 text-xs text-black/60 space-y-0.5">
          <li>Press “Copy AI prompt” and give it to ChatGPT, Claude or Gemini.</li>
          <li>Paste the AI&apos;s answer in the box below. Every word is placed in the right field automatically.</li>
          <li>Check the preview, then press “Add”.</li>
        </ol>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">Topic (optional)</label>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} list="bulk-topic-suggestions" placeholder="e.g. Travel" className={inputCls} />
          <datalist id="bulk-topic-suggestions">
            {existingTopics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Vocab set date (optional)</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Words to ask the AI for</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={MAX_IMPORT_WORDS}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className={inputCls}
            />
            <button
              type="button"
              onClick={copyPrompt}
              className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-white bg-leaf-600"
            >
              {copied ? "Copied ✓" : "Copy AI prompt"}
            </button>
          </div>
        </div>
      </div>

      <details className="text-xs text-black/60">
        <summary className="cursor-pointer select-none">Show the prompt</summary>
        <textarea readOnly value={buildVocabPrompt({ count, topic, date })} rows={10} className="mt-2 w-full rounded-xl border border-leaf-300 px-3 py-2 font-mono text-xs" />
      </details>

      <div>
        <label className="block text-xs font-medium mb-1">Paste the AI&apos;s answer here</label>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMessage(null);
          }}
          rows={10}
          placeholder={VOCAB_SAMPLE_BLOCK}
          className="w-full rounded-xl border border-leaf-300 px-3 py-2 font-mono text-xs"
        />
      </div>

      {message && (
        <div
          className={
            "rounded-xl border px-4 py-3 text-sm " +
            (message.kind === "ok" ? "border-leaf-300 bg-leaf-100 text-leaf-700" : "border-red-200 bg-red-50 text-red-700")
          }
        >
          {message.text}
        </div>
      )}

      {parsed.notes.length > 0 && (
        <ul className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-0.5">
          {parsed.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <>
          <p className="text-sm font-medium">
            {rows.length} word{rows.length === 1 ? "" : "s"} found · {chosen.length} will be added
            {needFix > 0 && <span className="text-red-600"> · {needFix} need fixing (edit the text above)</span>}
          </p>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <WordPreview
                key={i}
                item={r.item}
                exists={r.exists}
                on={r.on}
                blocked={r.blocked}
                onToggle={(v) => setOverride((o) => ({ ...o, [i]: v }))}
              />
            ))}
          </div>
          {!date && (
            <p className="text-xs text-black/50">
              No set date: these words join the general pool and are not shown as a daily set. Pick a date above to publish them as that day&apos;s set.
            </p>
          )}
          <button
            type="button"
            onClick={add}
            disabled={busy || chosen.length === 0}
            className="rounded-full px-5 py-2.5 font-semibold text-white bg-leaf-600 disabled:opacity-50"
          >
            {busy ? "Adding…" : `Add ${chosen.length} word${chosen.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}
    </section>
  );
}

function WordPreview({
  item,
  exists,
  on,
  blocked,
  onToggle,
}: {
  item: ParsedVocab;
  exists: boolean;
  on: boolean;
  blocked: boolean;
  onToggle: (v: boolean) => void;
}) {
  const d = item.draft;
  const synonyms = [d.synonym1, d.synonym2].filter(Boolean);
  const examples = [
    { en: d.example1En, bn: d.example1Bn },
    { en: d.example2En, bn: d.example2Bn },
  ].filter((e) => e.en || e.bn);
  return (
    <div className={"rounded-2xl border p-4 " + (blocked ? "border-red-300 bg-red-50/40" : on ? "border-leaf-300" : "border-black/10 opacity-70")}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={on} disabled={blocked} onChange={(e) => onToggle(e.target.checked)} className="mt-1.5 h-4 w-4" aria-label={`Add ${d.word || "this word"}`} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{d.word || "—"}</span>
            {d.pronunciation && <span className="text-sm text-black/60">{d.pronunciation}</span>}
            {d.partOfSpeech && <span className="rounded-full bg-leaf-100 px-2 py-0.5 text-xs font-medium text-leaf-700">{d.partOfSpeech}</span>}
            {exists && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Already in your list</span>}
            {item.duplicateInPaste && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Repeated in this paste</span>}
          </div>
          {d.meaningEn && <p className="text-sm">{d.meaningEn}</p>}
          {synonyms.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-black/50">Synonyms</span>
              {synonyms.map((s) => (
                <span key={s} className="rounded-full border border-leaf-300 px-2 py-0.5">
                  {s}
                </span>
              ))}
            </p>
          )}
          {examples.length > 0 && (
            <ul className="space-y-1 text-sm">
              {examples.map((e, i) => (
                <li key={i} className="border-l-2 border-leaf-300 pl-3">
                  <div>{e.en || <em className="text-black/40">no English sentence</em>}</div>
                  {e.bn && <div className="text-black/60">{e.bn}</div>}
                </li>
              ))}
            </ul>
          )}
          {item.errors.length > 0 && (
            <ul className="text-xs text-red-700 space-y-0.5">
              {item.errors.map((m) => (
                <li key={m}>✘ {m}</li>
              ))}
            </ul>
          )}
          {item.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 space-y-0.5">
              {item.warnings.map((m) => (
                <li key={m}>⚠ {m}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
