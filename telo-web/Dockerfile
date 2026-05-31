# --- Dependencies ------------------------------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Skip Puppeteer's bundled-Chromium download — the runtime image installs the
# system `chromium` package and points PUPPETEER_EXECUTABLE_PATH at it instead.
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --- Build -------------------------------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    PUPPETEER_SKIP_DOWNLOAD=1
RUN npm run build

# --- Runtime (standalone) ----------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium + fonts for the Reporting-tab PDF render (headless Puppeteer).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       chromium fonts-liberation ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Next.js standalone output bundles only the needed node_modules.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Ship SQL + deploy script so `npm run deploy:sp` can run inside the container.
COPY --from=build /app/db/sql ./db/sql
# Letterhead template for the on-letterhead report PDF.
COPY --from=build /app/report-assets ./report-assets

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
