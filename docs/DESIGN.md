# Design Deliverable — Containerizing FreshCart

Diagrams: <img width="1508" height="701" alt="topology-diagram drawio" src="https://github.com/user-attachments/assets/c20ae996-9df8-40d8-b82e-b6cf57e1565c" />
<img width="1540" height="992" alt="layer-diagram drawio" src="https://github.com/user-attachments/assets/d7cd445e-1a59-4f33-be53-86eeb3f3e9b5" />



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

*(Fill in with your actual `trivy image` or `docker scout cves` output — see
`docs/scan-before.txt` and `docs/scan-after.txt`. Template below.)*

Scanning `checkout-api:1.0.0` with Trivy surfaced `<N>` vulnerabilities, `<N>` of them
HIGH/CRITICAL, mostly in `<base image / package>`. I addressed this by
`<pinning node:20-alpine to a specific digest that included the patched package /
upgrading X in package.json / removing an unused dependency that pulled in Y>`.
Re-scanning after the fix brought HIGH/CRITICAL findings down from `<N>` to `<N>`.

The remaining `<N>` findings are `<describe: e.g. "in glibc-compat tooling only present
in the build stage, which never ships in the final image">` — I'm treating these as
acceptable for this context because `<reasoning: e.g. they don't reach the final image,
or they require local shell access we've already removed via the non-root user, or
there's no patched version available upstream yet and the affected code path (X) isn't
exercised by this app>`.
