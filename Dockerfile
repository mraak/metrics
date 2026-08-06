# SQL-Metrics Studio — Next.js app, built as a standalone server bundle.
# This deployment always talks to Postgres (DATABASE_URL is set — see
# README-DEPLOY.md), so better-sqlite3 (an optionalDependency, used only for
# local dev without a database) is skipped: no native compile, no alpine/musl
# prebuild headaches, smaller image.

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app/studio
COPY studio/package.json studio/package-lock.json ./
RUN npm ci --omit=optional

FROM node:20-alpine AS builder
WORKDIR /app/studio
COPY --from=deps /app/studio/node_modules ./node_modules
COPY studio/ ./
COPY knowledge_definitions.json ../knowledge_definitions.json
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app/studio
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/studio/public ./public
# .next/standalone already contains a pruned node_modules + server.js;
# .next/static isn't included in `standalone` and must be copied separately.
COPY --from=builder --chown=nextjs:nodejs /app/studio/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/studio/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/knowledge_definitions.json ../knowledge_definitions.json

USER nextjs
EXPOSE 3100
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
