"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Swords, Users, Link2, KeyRound, Loader2, X, ArrowLeft } from "lucide-react";

type GateState =
  | { status: "loading" }
  | { status: "unauthorized"; message: string }
  | { status: "forbidden"; message: string }
  | { status: "ready" };

type Mode = "menu" | "queue" | "create-waiting" | "join";

export default function VocabBattleLivePage() {
  const router = useRouter();
  const [gate, setGate] = useState<GateState>({ status: "loading" });
  const [mode, setMode] = useState<Mode>("menu");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  // Membership gate — same pattern as /dashboard/classes.
  useEffect(() => {
    fetch("/api/profile")
      .then(async (res) => {
        const data = await res.json();
        if (res.status === 401) {
          setGate({ status: "unauthorized", message: data.error ?? "Please log in first." });
        } else if (!res.ok) {
          setGate({ status: "forbidden", message: data.error ?? "Something went wrong." });
        } else if (!data.profile?.subscriptionActive) {
          setGate({ status: "forbidden", message: "Live Multiplayer is a Speaking Club membership perk." });
        } else {
          setGate({ status: "ready" });
        }
      })
      .catch(() => setGate({ status: "forbidden", message: "Something went wrong." }));
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  function startRandomMatch() {
    setError(null);
    setMode("queue");
    const tick = async () => {
      try {
        const res = await fetch("/api/vocab-battle/live/queue", { method: "POST" });
        const data = await res.json();
        if (cancelledRef.current) return;
        if (!res.ok) {
          setError(data.error || "Something went wrong.");
          stopPolling();
          setMode("menu");
          return;
        }
        if (data.status === "matched") {
          stopPolling();
          router.push(`/dashboard/vocab-battle/live/${data.matchId}`);
        }
      } catch {
        // transient network hiccup — keep polling, don't bail on one miss
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2500);
  }

  function cancelQueue() {
    stopPolling();
    setMode("menu");
    fetch("/api/vocab-battle/live/queue", { method: "DELETE" }).catch(() => {});
  }

  async function createRoom() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/vocab-battle/live/create", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create a room.");
        return;
      }
      setRoomCode(data.roomCode);
      setMode("create-waiting");

      const tick = async () => {
        try {
          const statusRes = await fetch(`/api/vocab-battle/live/match/${data.matchId}`);
          const statusData = await statusRes.json();
          if (cancelledRef.current) return;
          if (statusRes.ok && statusData.status === "active") {
            stopPolling();
            router.push(`/dashboard/vocab-battle/live/${data.matchId}`);
          }
        } catch {
          // keep polling
        }
      };
      pollRef.current = setInterval(tick, 2000);
    } finally {
      setBusy(false);
    }
  }

  function cancelCreatedRoom() {
    stopPolling();
    setMode("menu");
    setRoomCode("");
  }

  async function joinRoom() {
    setError(null);
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setError("Enter a room code.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/vocab-battle/live/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not join that room.");
        return;
      }
      router.push(`/dashboard/vocab-battle/live/${data.matchId}`);
    } finally {
      setBusy(false);
    }
  }

  if (gate.status === "loading") {
    return <p className="font-body text-sm text-ink-soft dark:text-cream/50">Loading…</p>;
  }

  if (gate.status === "unauthorized" || gate.status === "forbidden") {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-ink/15 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
          <Users size={26} />
        </div>
        <p className="mt-5 font-display text-lg font-semibold">{gate.message}</p>
        <Link
          href={gate.status === "unauthorized" ? "/login" : "/payment"}
          className="mt-4 rounded-pill bg-leaf-500 px-5 py-2 font-body text-sm font-semibold text-white hover:bg-leaf-600"
        >
          {gate.status === "unauthorized" ? "Log in" : "Activate membership"}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/dashboard/vocab-battle"
        className="inline-flex items-center gap-1.5 font-body text-sm font-medium text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
      >
        <ArrowLeft size={15} />
        Back to Arena
      </Link>

      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mt-3 font-display text-2xl font-semibold italic tracking-tight text-leaf-700 dark:text-leaf-500 md:text-3xl"
      >
        Live Multiplayer
      </motion.h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Race another student through the same 10 words, in real time.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 font-body text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      {mode === "menu" && (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <button
            onClick={startRandomMatch}
            className="flex flex-col items-start gap-3 rounded-2xl border border-ink/10 bg-cream-soft p-6 text-left transition-colors hover:border-leaf-500 dark:border-night-border dark:bg-night-soft"
          >
            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
              <Swords size={20} />
            </div>
            <div>
              <p className="font-display text-base font-semibold">Random Match</p>
              <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
                Get paired with another member who&apos;s ready right now.
              </p>
            </div>
          </button>

          <button
            onClick={createRoom}
            disabled={busy}
            className="flex flex-col items-start gap-3 rounded-2xl border border-ink/10 bg-cream-soft p-6 text-left transition-colors hover:border-leaf-500 disabled:opacity-60 dark:border-night-border dark:bg-night-soft"
          >
            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
              <Link2 size={20} />
            </div>
            <div>
              <p className="font-display text-base font-semibold">Create Room</p>
              <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
                Get a code to challenge a specific friend.
              </p>
            </div>
          </button>

          <div className="flex flex-col items-start gap-3 rounded-2xl border border-ink/10 bg-cream-soft p-6 sm:col-span-2 dark:border-night-border dark:bg-night-soft">
            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
              <KeyRound size={20} />
            </div>
            <p className="font-display text-base font-semibold">Join Room</p>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter room code"
                maxLength={8}
                className="flex-1 rounded-xl border border-ink/15 bg-white px-4 py-2.5 font-body text-sm uppercase tracking-widest text-ink outline-none focus:border-leaf-500 dark:border-night-border dark:bg-night dark:text-cream"
              />
              <button
                onClick={joinRoom}
                disabled={busy}
                className="rounded-xl bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700 disabled:opacity-60"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "queue" && (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-ink/10 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
          <Loader2 size={28} className="animate-spin text-leaf-600 dark:text-leaf-500" />
          <p className="font-display text-lg font-semibold">Finding an opponent…</p>
          <p className="font-body text-sm text-ink-soft dark:text-cream/60">
            This can take a moment if no one else is online right now.
          </p>
          <button
            onClick={cancelQueue}
            className="mt-2 flex items-center gap-1.5 rounded-pill border border-ink/15 px-4 py-2 font-body text-sm font-medium text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/70 dark:hover:bg-night"
          >
            <X size={14} />
            Cancel
          </button>
        </div>
      )}

      {mode === "create-waiting" && (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl border border-ink/10 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
          <p className="font-body text-sm text-ink-soft dark:text-cream/60">Share this code with your friend</p>
          <p className="font-display text-4xl font-bold tracking-[0.3em] text-leaf-700 dark:text-leaf-500">
            {roomCode}
          </p>
          <p className="flex items-center gap-2 font-body text-sm text-ink-soft dark:text-cream/50">
            <Loader2 size={15} className="animate-spin" />
            Waiting for them to join…
          </p>
          <button
            onClick={cancelCreatedRoom}
            className="mt-2 flex items-center gap-1.5 rounded-pill border border-ink/15 px-4 py-2 font-body text-sm font-medium text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/70 dark:hover:bg-night"
          >
            <X size={14} />
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
