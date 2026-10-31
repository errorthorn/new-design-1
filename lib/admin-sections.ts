// Client-safe list of the admin sections a staff member can be given. Kept apart from
// lib/admin-auth.ts because that file pulls in server-only code (crypto, Supabase).
export const ADMIN_SECTIONS = ["scoring", "questions", "speaking-club", "mock-test", "quiz"] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const ADMIN_SECTION_LABELS: Record<AdminSection, string> = {
  scoring: "Scoring",
  questions: "Questions",
  "speaking-club": "Speaking Club",
  "mock-test": "Mock Test",
  quiz: "Quiz",
};

export function isAdminSection(value: unknown): value is AdminSection {
  return typeof value === "string" && (ADMIN_SECTIONS as readonly string[]).includes(value);
}
