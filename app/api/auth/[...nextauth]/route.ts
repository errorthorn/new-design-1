// app/api/auth/[...nextauth]/route.ts
//
// Mounts NextAuth's own API endpoints (/api/auth/signin, /api/auth/callback/google,
// /api/auth/session, /api/auth/csrf, etc.) using the shared config in
// lib/next-auth-options.ts. Without this file, the Google sign-in button
// (signIn("google", ...) in app/login/page.tsx, app/signup/page.tsx, and
// components/auth-modal.tsx) has nothing to talk to and fails at click time —
// this route is what makes that actually work, not just configured.
import NextAuth from "next-auth";
import { authOptions } from "@/lib/next-auth-options";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
