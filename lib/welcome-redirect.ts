// lib/welcome-redirect.ts
//
// Every place someone can log in or sign up — the standalone /login and
// /signup pages, and the shared <AuthModal> popped up from speaking-club,
// mock-test, and payment — needs to show the same "you're in, here's the
// dashboard" congratulations modal afterwards.
//
// Credential login/signup and Google OAuth need two different mechanisms
// to relay "auth just succeeded" to wherever the person lands (Google's
// flow is a full redirect that unmounts any component state). A single
// URL marker works for both: append ?welcome=1 to the destination, and a
// single globally-mounted watcher (components/auth-welcome-watcher.tsx)
// shows the modal whenever it sees that marker, then strips it from the
// URL so refreshing or sharing the link doesn't replay it.
export function withWelcome(path: string): string {
  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;

  const qIndex = withoutHash.indexOf("?");
  const pathname = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const query = qIndex >= 0 ? withoutHash.slice(qIndex + 1) : "";

  const params = new URLSearchParams(query);
  params.set("welcome", "1");

  return `${pathname}?${params.toString()}${hash}`;
}
