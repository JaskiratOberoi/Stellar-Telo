import { z } from 'zod';

/**
 * Boot-time environment validation. Mirrors the fail-fast behaviour of
 * Listec's getListecPoolConfig() throw — if required config is missing the
 * process should not start serving.
 */
const schema = z.object({
  // Noble SQL Server (Telo owns its own pool; nobleone login, same server as Listec)
  TELO_SQL_SERVER: z.string().min(1), // "host" or "host,port"
  TELO_SQL_DATABASE: z.string().default('Noble'),
  TELO_SQL_USER: z.string().min(1),
  TELO_SQL_PASSWORD: z.string(),
  TELO_SQL_ENCRYPT: z.string().optional(),
  TELO_SQL_TRUST_CERT: z.string().optional(),
  TELO_SQL_APP_NAME: z.string().default('TeloApp'),
  TELO_SQL_CONNECT_TIMEOUT_MS: z.coerce.number().default(15_000),
  TELO_SQL_REQUEST_TIMEOUT_MS: z.coerce.number().default(120_000),

  // Read-path proxy to the existing Listec container
  LISTEC_API_BASE_URL: z.string().url().default('http://listec:31311'),

  // Sessions / cache
  REDIS_URL: z.string().default('redis://redis:6379'),

  // Auth.js
  NEXTAUTH_SECRET: z.string().min(16),
  NEXTAUTH_URL: z.string().url().optional(),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

let cached: z.infer<typeof schema> | null = null;

export function env(): z.infer<typeof schema> {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Telo environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
