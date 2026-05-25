import type { NextAuthConfig } from 'next-auth';
import type { TeloUser } from '@/types/auth';

/**
 * Edge-safe Auth.js config. NO database / `server-only` imports — this is
 * what middleware.ts instantiates (the full config in config.ts pulls in
 * mssql via the Credentials authorize() and cannot run on the edge).
 *
 * Protected-route policy lives in `authorized`; the JWT/session shaping is
 * shared by both the edge and Node instances.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
  pages: { signIn: '/login' },
  trustHost: true,
  providers: [], // real provider added in config.ts (Node only)
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      // Secure default: everything requires login except the public allowlist.
      // /api/* routes do their own auth (NextAuth) and must be reachable
      // without a session cookie.
      const isPublic =
        path === '/' || path === '/login' || path.startsWith('/api/');
      if (isPublic) return true;
      return !!auth?.telo;
    },
    async jwt({ token, user }) {
      if (user) token.telo = user as unknown as TeloUser;
      return token;
    },
    async session({ session, token }) {
      if (token.telo) session.telo = token.telo as TeloUser;
      return session;
    },
  },
};
