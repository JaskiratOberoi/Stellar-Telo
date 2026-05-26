import NextAuth from 'next-auth';
import { authConfig } from '@/auth/base';

// Edge instance — only verifies the JWT and applies the `authorized` policy.
// No DB access here (the Node instance in auth/config.ts owns sign-in).
export const { auth: middleware } = NextAuth(authConfig);

export default middleware((req) => {
  // `authorized` callback in authConfig already gates /shop/*; nothing else.
  void req;
});

export const config = {
  // Run on app routes except static assets and the auth API.
  // /branding/* — invoice header logos (Noble + built-in Medicare) must load on print.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|branding).*)'],
};
