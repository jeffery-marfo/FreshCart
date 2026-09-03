# syntax=docker/dockerfile:1

# ---------- build stage ----------
# Full Node image: has the toolchain (npm, tsc) we need to compile TypeScript,
# but none of this ends up in the final image.
FROM node:20-alpine AS build

WORKDIR /app

# Dependency manifests first, on their own layer. This layer only changes
# when package.json/package-lock.json change — not on every source edit —
# so `npm ci` is skipped (cache hit) on rebuilds that only touch src/.
COPY package.json package-lock.json ./
RUN npm ci

# Source and build config come after deps, and get copied in last, so
# editing src/*.ts never invalidates the npm ci layer above.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- final stage ----------
# Minimal runtime base: no compilers, no npm cache, no shell utilities beyond
# what alpine ships. Much smaller attack surface and image size than the
# build stage or a full `node:20` (Debian-based) image.
FROM node:20-alpine AS final

ENV NODE_ENV=production
WORKDIR /app

# Same trick as the build stage: install prod-only deps before copying
# compiled app code, so code changes don't force a dependency reinstall.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Only the compiled output crosses the stage boundary — no src/, no
# tsconfig.json, no TypeScript compiler, no devDependencies.
COPY --from=build /app/dist ./dist

# node:20-alpine ships an unprivileged "node" user (uid 1000) out of the box;
# use it instead of inventing our own, and hand it ownership of /app.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Basic container-level health check so `docker ps` / compose can see when
# the API is actually able to serve traffic, not just that the process exists.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/healthz', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
