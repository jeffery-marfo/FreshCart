# Design Deliverable — Containerizing FreshCart

Diagrams: [`layer-diagram.png`](./layer-diagram.png) · [`topology-diagram.png`](./topology-diagram.png) (editable source: [`layer-diagram.drawio`](./layer-diagram.drawio) · [`topology-diagram.drawio`](./topology-diagram.drawio))

## Base image choice

Both services use Alpine-based images (`node:20-alpine` for the build stages and
`checkout-api`'s runtime, `nginx:1.27-alpine` for the storefront's runtime) instead of
their Debian-based equivalents. Alpine trades glibc for musl and a much smaller set of
preinstalled packages, which cuts both image size and the number of OS packages a
vulnerability scanner has to check — most base-image CVEs in the scan below turned out
to trace back to packages Alpine simply doesn't ship. The trade-off is real: musl's
subtle libc differences occasionally break native Node addons, and Alpine's package
versions lag Debian's. Neither service here has native addons (`pg` is pure JS), so the
trade-off cost nothing in this case. I did not use `distroless` or `scratch` — distroless
would've meant no shell at all, which makes debugging the container the first time
noticeably harder, and for a course project I wanted `docker exec ... sh` available while
I was still getting the Dockerfiles right.

## Layer ordering

In both Dockerfiles, `package.json`/`package-lock.json` are copied and `npm ci` run
*before* the actual source is copied in. Docker caches each layer and only invalidates a
layer (and everything after it) when its inputs change. Since dependency manifests
change far less often than application code, this ordering means a source-only edit
reuses the cached `npm ci` layer instead of reinstalling ~100 packages from the registry
every time. I verified this directly — see the before/after numbers in the blog post.
The same pattern is repeated in `checkout-api`'s final stage (deps installed before
`COPY --from=build`) so that stage benefits from the same caching, not just the build
stage.

## Multi-stage builds

Each Dockerfile has a `build` stage (full Node toolchain: TypeScript compiler, Vite,
dev dependencies) and a `final` stage that starts from a fresh minimal base and only
receives the compiled output via `COPY --from=build`. The compiler, the dev
dependencies, and the original TypeScript source never exist in the final image layers
at all — they're discarded with the build stage. This is what actually makes the
non-root and minimal-base decisions meaningful: there's no point serving from a small
final image if the final image still contains a full copy of `node_modules` including
every dev tool used to build it.

## Non-root user

Both final stages run as an unprivileged user — `node` (uid 1000, which
`node:20-alpine` ships by default) for `checkout-api`, and `nginx` for the storefront.
Running as root inside a container doesn't grant host root by default, but it removes a
layer of defense: a container escape or an arbitrary-file-write vulnerability in the app
is much more dangerous if the process inside the container can write anywhere,
install packages, or modify its own binaries. `nginx:alpine` doesn't run as `nginx` by
default even though the user exists in the image, so I had to explicitly `chown` the
paths nginx needs to write to (`/var/cache/nginx`, the pid file) and rewrite
`nginx.conf` to listen on port 8080 instead of 80, since unprivileged processes can't
bind ports below 1024.

## Networking and the API base URL

The storefront's Dockerfile deliberately leaves `VITE_API_BASE_URL` unset at build
time. Instead, nginx reverse-proxies `/api/*` to `checkout-api:3000` on the shared
compose network (see `storefront/nginx.conf`). This mirrors exactly what Vite's dev
server proxy does locally (see `vite.config.ts`), so the same built frontend code works
identically in dev and in the container — no environment-specific API URLs baked into
the JS bundle, and no CORS headers needed anywhere, since the browser only ever talks
to one origin.

## Volume: why the database and nothing else

Only `db` has a named volume (`db-data`, mounted at
`/var/lib/postgresql/data`). `checkout-api` and `storefront` are both stateless —
every byte they need at runtime is either baked into the image or read from the
environment, and losing a running container costs nothing but a restart. Postgres is
the opposite: its actual data files are what make it a database rather than an empty
schema, and that data has to survive `docker compose down` / container recreation
(e.g. after an image rebuild) or the whole point of persistence is lost. `db/init.sql`
is bind-mounted read-only into `/docker-entrypoint-initdb.d/`, which Postgres's
official image runs automatically the *first* time it initializes an empty data
directory — so the seed only ever runs once, against the volume, not against the
image.

## Vulnerability scan: what I found and what I did

I scanned `jefftheson/freshcart-checkout-api:1.0.0` with Docker Scout
(`docker scout cves ...`). It flagged **57 vulnerabilities across 14 packages** — 4
CRITICAL, 34 HIGH, 14 MEDIUM, 5 LOW. 
<img width="1349" height="167" alt="Vulnerabilities Before" src="https://github.com/user-attachments/assets/de9e51e0-230c-4d0c-8109-2d808af299b4" />


Looking at the actual package list, the large majority weren't in anything I control
directly. `checkout-api` depends on exactly two runtime packages — `express` and
`pg`. Everything else the scanner flagged (`tar`, `minimatch`, `glob`, `pacote`,
`sigstore`, `@sigstore/core`, `cross-spawn`, `brace-expansion`) turned out to be
internal packages bundled inside the **npm CLI itself**, which `node:20-alpine`
installs globally so `npm ci` can run during the build. The final image never invokes
`npm` at runtime — the container's entrypoint is `node dist/index.js` — so that tooling
was sitting in the shipped image without ever being used.

I fixed this by removing the npm CLI (and everything bundled inside it) from the final
stage, right after using it to install production dependencies:

```dockerfile
RUN npm ci --omit=dev && npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
```

I rebuilt, re-tagged as `1.0.2`, pushed, and re-scanned. Confirmed the app still worked
correctly first (`docker compose ps` all healthy, `/healthz` and `/api/products` both
responding normally) — removing npm doesn't touch anything the app actually calls.
Result: **28 vulnerabilities across 3 packages** — 3 CRITICAL, 15 HIGH, 8 MEDIUM, 2 LOW.
That's a reduction of more than half the total count and roughly 79% of the affected
packages (14 → 3), without changing a single line of application code.
<img width="946" height="167" alt="Vulnerabilities after scan" src="https://github.com/user-attachments/assets/a4eacc76-f1bb-45ab-bae4-4f764a3c8d28" />


The remaining findings are all in **openssl**, part of the Alpine OS layer inside
`node:20-alpine` itself — not something reachable by editing `package.json` or the
Dockerfile's `COPY`/`RUN` steps. I confirmed this wasn't something I could fix by simply
re-pulling the base image (`docker pull node:20-alpine` followed by a `--no-cache`
rebuild produced an identical scan result), which means the currently-published
`node:20-alpine` tag on Docker Hub hasn't picked up a patched OpenSSL build yet. I'm
treating this as an accepted risk for this project rather than something to hand-patch:
the fix path here is upstream (waiting for a new Alpine/OpenSSL release to land in the
official `node:20-alpine` image, or pinning to a `distroless`/different base with a
newer OpenSSL build), not something this Dockerfile's structure can solve on its own.

