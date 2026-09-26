// Augments NextAuth's built-in types with the one custom field we add in
// lib/next-auth-options.ts: session.user.dbId, which links a Google session
// back to the matching row in our own `users` table. See ARCHITECTURE.md.
import "next-auth";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: {
      dbId?: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    dbId?: number;
  }
}
