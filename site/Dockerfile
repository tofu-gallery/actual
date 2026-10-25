# Tofu (2026-10-25): the image Tofu builds for a copy of Actual from its gallery.
#
# `web/` is Actual's web client, built from this repository's source by upstream's own `yarn build:browser` (see
# TOFU.md at the repository root), and `server.mjs` serves it with the Cross-Origin-Opener-Policy and
# Cross-Origin-Embedder-Policy headers the client needs. Nothing is installed or built here: the server has no
# dependencies. Tofu's hosting sets PORT (80 when it does not).
FROM mirror.gcr.io/library/node:22-alpine

ENV NODE_ENV=production
WORKDIR /app
COPY LICENSE.txt server.mjs ./
COPY web ./web

EXPOSE 80
CMD ["node", "server.mjs"]
