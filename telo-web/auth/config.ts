import 'server-only';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { authConfig } from '@/auth/base';
import { authenticateUser } from '@/db/sp/authenticateUser';
import { fetchTeloRole } from '@/db/read/teloUsers';
import { getSessionVersion } from '@/db/read/sessionVersion';
import { deriveCapabilities } from '@/auth/rbac';
import { rateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import type { TeloUser } from '@/types/auth';

/**
 * Full (Node) Auth.js instance — extends the edge-safe base with the
 * Credentials provider whose authorize() hits Noble.
 *
 * SECURITY NOTE (stakeholder-accepted): Noble stores passwords in PLAINTEXT.
 * usp_telo_authenticate mirrors the legacy LIS check via a typed SQL param
 * (not an injection vector). Credentials are never logged. Mitigations:
 * TLS to DB, short JWT TTL, login rate-limit (P6). bcrypt shadow-column
 * migration is post-v1.
 */
const credsSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(50),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { username, password } = parsed.data;

        const ip =
          request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          'unknown';
        // 8 attempts / 15 min per username+IP. Fail-CLOSED for login
        // (see lib/rate-limit.ts) — better to lock everyone out briefly than
        // to disable brute-force protection during a Redis incident.
        const rl = await rateLimit(`login:${username}:${ip}`, 8, 900);
        if (!rl.allowed) {
          audit({ kind: 'login.rate_limited', username });
          return null;
        }

        const row = await authenticateUser(username, password);
        if (!row) {
          audit({ kind: 'login.failure', username, reason: 'bad_credentials' });
          return null;
        }
        audit({ kind: 'login.success', username, uid: row.user_id });

        // Telo role (from tbl_telo_user_role) wins over LIS-derived caps; if
        // absent, LIS Super Admin auto-bootstraps to super_admin (see rbac.ts).
        const teloRole = await fetchTeloRole(row.user_id);
        // Capture the user's current session-version snapshot — any later
        // admin action that bumps this row revokes the token we mint here.
        const sv = await getSessionVersion(row.user_id);

        const user: TeloUser = {
          uid: row.user_id,
          username: row.username,
          name:
            [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
            row.username,
          email: row.email,
          usertypeId: row.usertype_id,
          usertypeName: row.usertype_name,
          pccId: row.pcc_id,
          subPccId: row.sub_pcc_id,
          buId: row.business_unit_id,
          teloRole,
          caps: deriveCapabilities(row, teloRole),
          sv,
        };
        return { id: String(user.uid), ...user } as never;
      },
    }),
  ],
  callbacks: {
    // Inherit edge-safe authorized() + jwt/session shaping from base, then
    // layer on a Node-only freshness check. CRITICAL: spread first so the
    // base `authorized` + `jwt` callbacks survive — without them the JWT
    // never gets `token.telo` populated at sign-in and every login looks
    // like it "succeeded" (authorize ran) but the session ends up empty
    // and middleware bounces the user straight back to /login.
    //
    // The base session callback ran FIRST and copied token.telo onto
    // session.telo; we now compare the embedded `sv` against the live
    // version (Redis-cached 30s) and clear session.telo if they differ.
    // requireSession() will then redirect to /login on the next request —
    // taking the deactivated/demoted user out without waiting for natural
    // JWT expiry.
    ...authConfig.callbacks,
    async session({ session, token }) {
      const base = await authConfig.callbacks?.session?.({ session, token } as Parameters<
        NonNullable<NonNullable<typeof authConfig.callbacks>['session']>
      >[0]);
      const s = (base ?? session) as typeof session;
      const telo = s?.telo;
      if (!telo) return s;
      try {
        const current = await getSessionVersion(telo.uid);
        if (current !== telo.sv) {
          audit({
            kind: 'session.revoked',
            uid: telo.uid,
            embedded: telo.sv,
            current,
          });
          return { ...s, telo: undefined as unknown as typeof telo };
        }
      } catch {
        // Best-effort: a DB/Redis blip should not log everyone out. The
        // version check is defence-in-depth on top of the JWT TTL — if it
        // can't run, we fall back to trusting the JWT.
      }
      return s;
    },
  },
});
