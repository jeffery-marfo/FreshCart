# How to finish this assignment on your own machine

Everything that needed Docker itself to run (builds, the registry push, the vulnerability
scan, the before/after timing) has to happen on a machine with Docker installed — I don't
have Docker available in this environment, so I've written and sanity-checked the code
(`npm run build` succeeds for both services — see below) but not run these commands
myself. Copy/paste these in order.

## 0. Sanity check already done

I ran both services' actual build commands outside Docker to confirm the Dockerfiles'
`RUN npm run build` steps will succeed:

```
checkout-api: npm ci && npm run build   → tsc compiles cleanly, dist/ produced
storefront:   npm ci && npm run build   → tsc && vite build succeeds, dist/ produced (~3KB JS, ~1.6KB CSS gzipped)
```

## 1. Build and run the whole stack

```bash
cd FreshCart
docker compose build
docker compose up -d
docker compose ps                       # all three should show healthy/running

curl http://localhost:3000/healthz      # {"status":"ok"}
curl http://localhost:3000/api/products # seeded product list
open http://localhost:8080              # storefront, talking to the API via nginx's /api proxy
```

## 2. Prove the layer-ordering fix actually works (Part 1, item 3)

```bash
# Clean build, no cache, time it
docker compose build --no-cache checkout-api

# Now change one line — e.g. add a comment to src/routes/health.ts — and rebuild
echo '// bump' >> checkout-api/src/routes/health.ts
time docker compose build checkout-api
```

You should see the `RUN npm ci` step reported as `CACHED` and the rebuild finish in a
couple of seconds instead of re-downloading the whole dependency tree. Capture the
terminal output (screenshot or copy the text) — that's your before/after evidence for
both the submission and the blog post. Revert the comment afterward.

## 3. Tag and push to a registry (Part 1, item 5)

Pick one registry. Docker Hub is the simplest to set up for a course project:

```bash
docker login
docker tag freshcart-checkout-api:latest <your-dockerhub-username>/freshcart-checkout-api:1.0.0
docker push <your-dockerhub-username>/freshcart-checkout-api:1.0.0
```

Use a real semantic version tag (`1.0.0`), not `latest` — `latest` is mutable and
gives you no way to know what actually got deployed later.

## 4. Scan and fix (Part 1, item 6)

With Trivy (install: `brew install trivy` / see trivy.dev for other platforms):

```bash
trivy image freshcart-checkout-api:1.0.0 > docs/scan-before.txt
cat docs/scan-before.txt
```

Or with Docker Scout (built into Docker Desktop):

```bash
docker scout cves freshcart-checkout-api:1.0.0 > docs/scan-before.txt
```

Look at what's flagged. Common, legitimate fixes for a Node/Alpine image:
- Bump a specific dependency version in `package.json` if the CVE is in a package you
  control directly (check `npm audit` too).
- Pin the base image to a specific digest (`node:20-alpine@sha256:...`) that includes a
  patched Alpine package build, if the CVE is in the OS layer.
- If a flagged CVE is in a devDependency that never reaches the final stage (check the
  layer diagram), that's a legitimate "not applicable to the final image" note rather
  than something to fix.

Make one real fix, rebuild, and re-scan:

```bash
trivy image freshcart-checkout-api:1.0.0 > docs/scan-after.txt
diff docs/scan-before.txt docs/scan-after.txt
```

Write up what you found and what you did (or why you're accepting the risk) in
`docs/DESIGN.md` — there's a template section waiting for it.

## 5. Stretch goal: prove the volume survives

```bash
docker compose up -d
curl -s -X POST http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerName":"Test","customerEmail":"test@example.com","items":[{"productId":1,"quantity":1}]}'
# note the returned order id

docker compose kill db          # simulate a crash
docker compose up -d db         # bring it back
sleep 3
curl http://localhost:3000/api/orders/<the id from above>   # still there
```

Screen-record or screenshot this — it's good, concrete evidence for the blog post's
"what I learned" section, and it's the kind of thing that's genuinely satisfying to see
work the first time.

## 6. Finish and submit

- Fill in `docs/DESIGN.md`'s scan section with your real numbers.
- Fill in `docs/blog-post-draft.md`'s bracketed placeholders with your real numbers,
  publish it (Dev.to / Hashnode / Medium / your own site), and paste the link at the
  top of your repo README.
- Commit everything (`Dockerfile`s, `docker-compose.yml`, `docs/`) and push to a public
  GitHub repo.
