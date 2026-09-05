# syntax=docker/dockerfile:1

# ---------- build stage ----------
# Node image with the full toolchain to run tsc + the Vite build.
# None of this (node_modules, TypeScript compiler, Vite itself) ships
# in the final image — only the static output does.
FROM node:20-alpine AS build

WORKDIR /app

# Deps on their own layer first, keyed only on the manifest files, so
# `npm ci` cache-hits on rebuilds that only touch src/ or index.html.
COPY package.json package-lock.json ./
RUN npm ci

# Build-time config and source copied in after deps are installed.
COPY tsconfig.json vite.config.ts vite-env.d.ts index.html ./
COPY src ./src

# VITE_API_BASE_URL intentionally left unset: nginx reverse-proxies /api
# to the checkout-api container (see nginx.conf), so the built app calls
# same-origin relative paths, same as the Vite dev proxy does locally.
RUN npm run build

# ---------- final stage ----------
# nginx's alpine variant: no Node, no npm, no build tooling, no source —
# just a web server and static files. Far smaller surface than the build
# stage, and than nginx's Debian-based image.
FROM nginx:1.27-alpine AS final

# Custom config: unprivileged (listens on 8080, temp/pid paths under /tmp)
# and reverse-proxies /api to the checkout-api service.
COPY nginx.conf /etc/nginx/nginx.conf

# Only the compiled static output crosses the stage boundary.
COPY --from=build /app/dist /usr/share/nginx/html

# The nginx:alpine image already ships an unprivileged "nginx" user;
# it just isn't used by default. Hand it ownership of the paths it needs
# to write to (cache dirs, pid file, temp dirs, the html root) and switch
# to it instead of running as root.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /etc/nginx && \
    touch /tmp/nginx.pid && chown nginx:nginx /tmp/nginx.pid

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
