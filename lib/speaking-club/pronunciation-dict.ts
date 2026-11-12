// lib/speaking-club/pronunciation-dict.ts
//
// SERVER ONLY (the feedback worker): loads the CMU Pronouncing Dictionary (data/cmudict.json, ~124k words,
// ISC license, see data/CMUDICT-LICENSE.txt) once per server instance. Loaded lazily so a route that never
// checks pronunciation does not pay for the 3.7 MB file.
import type { Dict } from "@/lib/speaking-club/pronunciation-rules";

let cache: Dict | null = null;

export async function loadPronunciationDict(): Promise<Dict> {
  if (!cache) cache = (await import("@/lib/speaking-club/data/cmudict.json")).default as Dict;
  return cache;
}
