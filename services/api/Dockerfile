# syntax=docker/dockerfile:1
#
# openGym API for Railway (community template, not affiliated with openGym).
#
# The official API image, unchanged, plus two files:
#   railway-entrypoint.sh  checks the volume, RP_ID and ORIGIN, runs the owner setup, then
#                          execs upstream's own command (node server.js);
#   seed-owner.mjs         on an instance without profiles, creates the owner (admin) with
#                          openGym's own password.js before the API port opens.
#
# Upgrade: set OPENGYM_VERSION on the openGym (web) service; this service reads the same value
# (Railway passes it in as a build argument). Keep the API and the web image on one release.
# Read https://github.com/DuarteSantos8/openGym/blob/main/CHANGELOG.md first and back up the
# volume. Persistence is declared in template.json only: Railway mounts the volume at /data.
ARG OPENGYM_VERSION=1.4.3
FROM ghcr.io/duartesantos8/opengym-api:${OPENGYM_VERSION}

COPY --chmod=0755 railway-entrypoint.sh /usr/local/bin/railway-opengym-entrypoint.sh
COPY --chmod=0644 seed-owner.mjs /app/railway/seed-owner.mjs

# Fail the build, not the deploy, when a new image no longer provides what the wrapper uses:
# the files below, openGym's password and durable-write helpers (the self-test creates owners in
# temporary directories, verifies the stored hash with openGym's verifyPassword and checks that
# weak input is refused).
RUN set -eu; \
    sh -n /usr/local/bin/railway-opengym-entrypoint.sh; \
    for f in server.js password.js durable.js recover.js admin-socket.js package.json; do \
      test -f "/app/$f" || { echo "missing /app/$f" >&2; exit 1; }; \
    done; \
    node --check /app/railway/seed-owner.mjs; \
    node /app/railway/seed-owner.mjs --self-test

ENV PORT=8080 \
    DATA_DIR=/data

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/railway-opengym-entrypoint.sh"]
CMD ["node", "server.js"]
