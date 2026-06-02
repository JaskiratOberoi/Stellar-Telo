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
// trustHost must stay true: the app runs behind Caddy in prod (and behind
// the docker bridge in dev), so Auth.js sees the request via a reverse
// proxy. With trustHost=false the library rejects the forwarded Host header
// with UntrustedHost and breaks /api/auth/* entirely.
//
// NEXTAUTH_URL still matters and IS set in prod — it pins the canonical URL
// for callbacks/redirects so a forged Host header can't trick Auth.js into
// redirecting elsewhere. The two settings cover different concerns; the
// host-pinning protection comes from NEXTAUTH_URL, not from trustHost.

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
        path === '/' ||
        path === '/login' ||
        path.startsWith('/api/') ||
        // Public, token-gated patient softcopy link (the printed QR target).
        path.startsWith('/r/') ||
        // The print fragment when carrying a report token — the page itself
        // validates the HMAC token (an invalid one 404s), so middleware only
        // needs to let the tokenised request through without a session.
        (path.startsWith('/print/reporting/') &&
          request.nextUrl.searchParams.has('token'));
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
