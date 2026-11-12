// lib/speaking-club/storage/segment-store.ts
//
// Device-local safety net for the post-call Whisper flow. While a call runs,
// the student's speech (silence already removed, 16 kHz, 16-bit) is kept in
// memory AND mirrored here, in the browser's own IndexedDB, so that closing the
// tab, a refresh, a crash or a dead battery before "AI feedback" has been made
// does not lose the session: the next visit finishes it in the background.
//
// Nothing here ever leaves the device. A session is deleted as soon as its
// transcript has been submitted (or the session is given up on / expires).
// Every function is best-effort and resolves quietly if IndexedDB is missing or
// blocked (some private modes) — callers then simply keep using memory.

const DB_NAME = "lc-speaking-segments";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const SEGMENTS = "segments";

export type SessionMeta = {
  sessionId: string;
  shiftId: string;
  studentUsername: string;
  topicTitle?: string;
  cueCardQuestions?: string[];
  /** Text another engine (Web Speech) had already captured before Whisper took over. */
  priorTranscript: string;
  /** BYOK: pronunciation notes that go with `priorTranscript` (kept for a submit that has to be retried). */
  priorNotes?: string[];
  createdAt: number;
  /** Heartbeat while capturing; lets a later visit tell "still in a call" from "abandoned". */
  updatedAt: number;
  /** capturing = call in progress; ready = call over, waiting to be transcribed. */
  status: "capturing" | "ready";
  /** How many times processing this session has failed to finish. */
  attempts: number;
  segmentCount: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: "sessionId" });
        if (!db.objectStoreNames.contains(SEGMENTS)) {
          const s = db.createObjectStore(SEGMENTS, { keyPath: "key" });
          s.createIndex("sessionId", "sessionId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

const segKey = (sessionId: string, idx: number) => `${sessionId}:${String(idx).padStart(6, "0")}`;

export async function saveSession(meta: SessionMeta): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(SESSIONS, "readwrite");
    tx.objectStore(SESSIONS).put(meta);
    await done(tx);
  } catch {
    // best-effort
  }
}

export async function saveSegment(sessionId: string, idx: number, data: Int16Array): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(SEGMENTS, "readwrite");
    tx.objectStore(SEGMENTS).put({ key: segKey(sessionId, idx), sessionId, idx, data });
    await done(tx);
  } catch {
    // best-effort
  }
}

export async function deleteSegment(sessionId: string, idx: number): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(SEGMENTS, "readwrite");
    tx.objectStore(SEGMENTS).delete(segKey(sessionId, idx));
    await done(tx);
  } catch {
    // best-effort
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    return await new Promise<SessionMeta[]>((resolve) => {
      const req = db.transaction(SESSIONS, "readonly").objectStore(SESSIONS).getAll();
      req.onsuccess = () => resolve((req.result as SessionMeta[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function loadSegments(sessionId: string): Promise<Int16Array[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    return await new Promise<Int16Array[]>((resolve) => {
      const req = db.transaction(SEGMENTS, "readonly").objectStore(SEGMENTS).index("sessionId").getAll(sessionId);
      req.onsuccess = () => {
        const rows = (req.result as { idx: number; data: Int16Array }[]) ?? [];
        rows.sort((a, b) => a.idx - b.idx);
        resolve(rows.map((r) => r.data));
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction([SESSIONS, SEGMENTS], "readwrite");
    tx.objectStore(SESSIONS).delete(sessionId);
    const idx = tx.objectStore(SEGMENTS).index("sessionId");
    const cursorReq = idx.openCursor(IDBKeyRange.only(sessionId));
    cursorReq.onsuccess = () => {
      const c = cursorReq.result;
      if (c) {
        c.delete();
        c.continue();
      }
    };
    await done(tx);
  } catch {
    // best-effort
  }
}

// ---- 16-bit <-> float conversion (storage is half the size of Float32) ----

export function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export function int16ToFloat(i16: Int16Array): Float32Array {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / (i16[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}
