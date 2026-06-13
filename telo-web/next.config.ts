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
      // The Accounts "Export Excel" button (write-excel-file/browser) builds
      // the .xlsx in a Web Worker spawned from a blob: URL. Without an explicit
      // worker-src the browser falls back to script-src (no blob:), so the
      // worker is blocked and the button hangs on "Exporting…".
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      // Self framing is required: the Print Lab/Bill buttons load a same-
      // origin print fragment (/print/orders/[id]/[kind]) into a hidden
      // iframe and then call iframe.contentWindow.print(). With 'none' the
      // iframe is blocked and the call fails with a cross-origin permission
      // error in the console. 'self' still prevents third-party clickjacking.
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          // SAMEORIGIN (not DENY) so the print iframe in the Print buttons
          // can load; CSP frame-ancestors 'self' above does the real work,
          // this header is the legacy compatibility fallback.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
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
