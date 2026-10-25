# Fireround on Fly.io (otto deployment). Single machine: the Next.js server ticks its own cron routes
# hourly (lib/scheduler.ts), so the app must never auto-stop and runs as exactly one instance.
FROM node:24-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# No DATABASE_URL at build time: the app falls back to embedded PGlite under ./data for any
# build-time reads, and that directory is discarded below. Migrations run at container start.
RUN pnpm build && rm -rf ./data

FROM build AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
EXPOSE 3000
COPY fly/start.sh /app/fly/start.sh
RUN chmod +x /app/fly/start.sh
CMD ["/app/fly/start.sh"]
