// lib/next-auth-options.ts
//
// NextAuth is used ONLY for the Google sign-in handshake. We don't use a
// database adapter — sessions are JWT-based (NextAuth's own cookie, separate
// from our "session" cookie). On successful Google sign-in, we find-or-create
// a row in our OWN users table (lib/db.ts) and stash that row's id on the
// token, so getCurrentUser() (lib/auth.ts) can look the person up the same
// way regardless of which method they signed in with.
//
// Note: token.dbId and session.user.dbId are our own custom fields, not
// part of NextAuth's built-in types — that's why they're typed as `any`
// below rather than fighting NextAuth's module typing right now.

import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getDb } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      if (!user.email) return false;

      const db = await getDb();
      const existing = await db.execute({
        sql: "SELECT id FROM users WHERE email = ?",
        args: [user.email],
      });

      if (existing.rows[0]) {
        // Link the Google account to an existing email/password user, and
        // keep the avatar in sync with their current Google profile picture
        // on every sign-in (not just the first time).
        await db.execute({
          sql: "UPDATE users SET google_id = COALESCE(google_id, ?), avatar_url = ? WHERE id = ?",
          args: [account.providerAccountId, user.image || null, existing.rows[0].id],
        });
      } else {
        await db.execute({
          sql: "INSERT INTO users (email, name, google_id, avatar_url) VALUES (?, ?, ?, ?)",
          args: [user.email, user.name || null, account.providerAccountId, user.image || null],
        });
      }
      return true;
    },

    async jwt({ token }) {
      if (token.email && !token.dbId) {
        const db = await getDb();
        const res = await db.execute({
          sql: "SELECT id FROM users WHERE email = ?",
          args: [token.email],
        });
        if (res.rows[0]) token.dbId = Number(res.rows[0].id);
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) session.user.dbId = token.dbId ?? undefined;
      return session;
    },
  },
};
