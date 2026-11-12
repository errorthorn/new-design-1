"use client";

// Thin wrapper — all gameplay logic lives in
// components/vocab-battle/live-match-panel.tsx, shared with the embedded
// panel rendered inside the Speaking Club room page.
import { useParams, useRouter } from "next/navigation";
import { VocabBattleLiveMatchPanel } from "@/components/vocab-battle/live-match-panel";

export default function VocabBattleLiveMatchPage() {
  const params = useParams<{ matchId: string }>();
  const router = useRouter();

  return (
    <VocabBattleLiveMatchPanel
      matchId={Number(params.matchId)}
      onExit={() => router.push("/dashboard/vocab-battle")}
    />
  );
}
