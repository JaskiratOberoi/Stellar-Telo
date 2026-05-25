import 'server-only';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { authConfig } from '@/auth/base';
import { authenticateUser } from '@/db/sp/authenticateUser';
import { fetchTeloRole } from '@/db/read/teloUsers';
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
        // 8 attempts / 15 min per username+IP. Fail-open if redis is down.
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
        };
        return { id: String(user.uid), ...user } as never;
      },
    }),
  ],
});
