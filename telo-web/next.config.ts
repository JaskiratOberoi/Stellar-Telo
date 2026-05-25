import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Repo root also has a package-lock.json; pin tracing to this app so the
  // standalone bundle is scoped correctly in the Docker build.
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ['mssql', 'ioredis', 'pino'],
  eslint: { ignoreDuringBuilds: true },
  // New Order can carry an optional clinical-history PDF; the default 1MB
  // server-action body cap is too small for a multi-page scan.
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  async headers() {
    const csp = [
      "default-src 'self'",
      // Next.js runtime needs inline/eval.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
