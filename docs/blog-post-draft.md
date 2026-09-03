# Containerizing a Real App: What I Learned About Layers, Secrets, and Not Running as Root

*(Draft — fill in the [bracketed] parts with your own numbers and voice, then publish
to Dev.to / Hashnode / Medium / your own site.)*

## The problem I was actually solving

FreshCart is a small, real grocery-delivery app: a TypeScript/Express API
(`checkout-api`) backed by Postgres, and a static Vite frontend (`storefront`) that
calls it. Running it locally means: install Node 20, install Postgres, remember to run
the seed SQL, set two different `.env` files with a `DATABASE_URL` that matches
whatever Postgres setup you happened to choose, and hope your Node version matches
what the `package.json` engines field expects (or doesn't specify at all). None of that
is hard once — the problem shows up the second time, on a different machine, or when
someone else on the team tries it and their local Postgres is on a different port, or
they've got Node 18 instead of 20.

"Works on my machine" isn't really about broken code — it's about implicit
environment assumptions that never get written down anywhere a computer can check
them. Containerizing this app means writing those assumptions down as a Dockerfile:
here's the exact runtime, here's exactly how to build the app, here's exactly what it
needs at runtime and nothing else.

## The Dockerfiles

Both services use a **multi-stage build**: a `build` stage with the full Node
toolchain, and a `final` stage that only receives the compiled output.

```dockerfile
# checkout-api/Dockerfile — build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# final stage
FROM node:20-alpine AS final
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

Two things about the ordering matter here. First, `package.json` and
`package-lock.json` are copied — and `npm ci` run — *before* the actual source code is
copied in. Docker caches image layers and invalidates a layer (and everything after it
in the same stage) only when its own inputs change. Dependencies change rarely;
application code changes constantly. Reversing the order — copying all the source
first, then installing — means every single code change reinstalls every dependency
from scratch, which is exactly the kind of thing that makes a 10-second Docker rebuild
into a 90-second one.

Second, the final stage doesn't inherit anything from the build stage except one
explicit `COPY --from=build /app/dist ./dist`. No TypeScript compiler, no
`devDependencies`, no original `.ts` source. Just the compiled JavaScript, the
production dependencies, and the runtime.

The storefront follows the same shape but lands somewhere different — Vite compiles to
plain static files, so the final stage doesn't need Node *at all*:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine AS final
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /etc/nginx && \
    touch /tmp/nginx.pid && chown nginx:nginx /tmp/nginx.pid
USER nginx
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
```

## Security decisions

**Non-root.** Both final images run as an unprivileged user instead of the default
root — `node` (uid 1000, which ships in `node:20-alpine` already) for the API, and
`nginx` for the storefront. Root inside a container isn't the same as root on the host,
but it's still one fewer thing standing between "a vulnerability in my app" and "an
attacker who can rewrite files, install packages, or pivot further." Getting nginx
running as non-root took a bit more than adding `USER nginx` — by default the image's
own config assumes root (binding port 80, writing pid/cache files to locations only
root owns), so I rewrote `nginx.conf` to listen on 8080 and moved its writable paths
under `/tmp`, which I `chown` to the `nginx` user in the Dockerfile.

**Minimal base image.** Alpine variants for both the build and final stages —
`node:20-alpine`, `nginx:1.27-alpine` — instead of the Debian-based defaults. Smaller
image, fewer preinstalled OS packages, smaller surface for a scanner to flag. I didn't
go all the way to `distroless` (no shell at all); for a first pass at this I wanted
`docker exec ... sh` available while debugging the Dockerfiles themselves.

**The scan.** I ran `[trivy image checkout-api:1.0.0 / docker scout cves
checkout-api:1.0.0]` against the built image. It flagged
`[N vulnerabilities, N of them HIGH/CRITICAL, mostly in <package/base image>]`.
I fixed this by `[pinning the base image to a digest with the patch / bumping
<dependency> in package.json / removing an unused dependency]`, which brought
HIGH/CRITICAL findings down to `[N]`. The remaining findings are
`[in tooling that never reaches the final image / awaiting an upstream patch /
not reachable given how this app is used]`, which I'm treating as acceptable risk
for this project rather than blocking on — see `docs/DESIGN.md` for the full reasoning
and `docs/scan-before.txt` / `docs/scan-after.txt` for the raw output.

## Build speed: before and after getting layer order right

To see the effect of layer ordering directly, I built `checkout-api` twice from a
clean cache, then changed one line in `src/routes/health.ts` and rebuilt:

| | Bad ordering (source copied before `npm ci`) | Good ordering (deps installed first) |
|---|---|---|
| Full clean build | `[X]s` | `[X]s` |
| Rebuild after a 1-line source change | `[X]s — full `npm ci` reruns` | `[X]s — `npm ci` layer cache hit` |

`[Add your own numbers here — run `time docker build ...` twice: once with the
Dockerfile as written, once with a copy where you move `COPY . .` above `RUN npm ci`,
touch one file in src/, and rebuild both. The gap is usually dramatic — dependency
installs typically dominate build time for small apps like this one.]`

## What's next

This is Week 4 of building out FreshCart's infrastructure — `docker-compose.yml` wires
this image together with the storefront and Postgres on a shared network, with the
database's data in a named volume so it survives container restarts. Weeks 5–8 take
this same app through Terraform, CI/CD, Kubernetes, and observability. Full source,
Dockerfiles, and compose file: `[link to your public GitHub repo]`.
