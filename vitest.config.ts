import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the Speaking Club AI-feedback pipeline (lib/speaking-club/**).
// Run with `npm test`. They run in plain Node with small browser stubs
// (tests/speaking-club/helpers.ts): no real browser, model or network involved.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/speaking-club/setup.ts"],
    testTimeout: 15_000,
    // The existing tests cover the Whisper path; byok.test.ts switches BYOK on for itself.
    env: { NEXT_PUBLIC_GEMINI_BYOK: "false" },
  },
});
