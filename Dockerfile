# syntax=docker/dockerfile:1

# Three stages so the shipped image contains no compilers, no dev dependencies
# and no source — just the traced runtime output.

# ---------------------------------------------------------------- dependencies
FROM node:24-alpine AS deps
WORKDIR /app

# better-sqlite3 normally installs a prebuilt binary, but it falls back to
# compiling from source. Without these, that fallback fails the build outright.
# They live only in this stage and never reach the final image.
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

# ----------------------------------------------------------------------- build
FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# Collecting page data imports every route, and those imports construct the
# Postgres client, which throws when DATABASE_URL is unset. Nothing connects —
# postgres.js is lazy and every route here is dynamic — so a placeholder is
# enough to get through the build.
#
# Scoped to this stage deliberately. It does not exist in the runner below, so
# a deployment that forgets to inject the real URL fails loudly at startup
# instead of quietly trying to reach a database that was never there.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build

RUN npm run build

# A fresh clone has no generated sites yet, and COPY fails on a missing source.
RUN mkdir -p /app/generated-sites

# ---------------------------------------------------------------------- runner
FROM node:24-alpine AS runner
WORKDIR /app

# pg_dump powers the pre-scrape snapshot in src/lib/db/backup.ts. Its major
# version must be >= the server's, so this tracks the postgres image in
# docker-compose.yml — bump both together.
RUN apk add --no-cache postgresql17-client

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run unprivileged. node:alpine ships a `node` user for exactly this.
RUN mkdir -p /app/data && chown -R node:node /app

# `standalone` bundles the server and its traced dependencies; static assets and
# public files are deliberately excluded from it and have to come across too.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Not traced by the build — they are read at runtime by the migrator.
COPY --from=builder --chown=node:node /app/drizzle ./drizzle

# The demo sites, read off disk at request time by /demos/[...path]. They live
# outside `public/` so that pages generated after this image was built are still
# servable, which also means the build has to bring them along explicitly.
COPY --from=builder --chown=node:node /app/generated-sites ./generated-sites

USER node

# Backups and logs. Mounted as a volume in compose so they outlive a redeploy.
VOLUME /app/data

EXPOSE 3000

# No shell wrapper: node stays PID 1 so Coolify's stop signal reaches it and the
# container shuts down promptly instead of being killed after a timeout.
CMD ["node", "server.js"]
