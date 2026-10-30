# syntax=docker/dockerfile:1
#
# openGym web (the built app served by nginx, which proxies /api to the API service) for
# Railway. Community template, not affiliated with openGym.
#
# The official web image plus one start-up file and one config edit:
#   17-railway-opengym.envsh  sourced by nginx's entrypoint before the config is rendered: picks
#                             the DNS server from /etc/resolv.conf (upstream defaults to Docker's
#                             127.0.0.11), restores the visitor address from Railway's X-Real-IP
#                             header and sets the number of nginx workers;
#   ipv6=off removed          from openGym's two `resolver` lines, so the API's private domain
#                             also resolves on Railway networks that only give it an IPv6
#                             address (the API listens on both).
# The exercise images and animations are part of the upstream image; nothing is downloaded.
#
# Upgrade: change OPENGYM_VERSION on this service (Railway passes service variables in as build
# arguments) and redeploy both services; the API service reads the same variable.
ARG OPENGYM_VERSION=1.4.3
FROM ghcr.io/duartesantos8/opengym-web:${OPENGYM_VERSION}

USER root

COPY --chmod=0755 17-railway-opengym.envsh /docker-entrypoint.d/17-railway-opengym.envsh

# Fail the build, not the deploy, when a new image no longer looks the way this file expects.
RUN set -eu; \
    t=/etc/nginx/templates/default.conf.template; \
    grep -qF 'resolver ${RESOLVER} valid=10s ipv6=off;' "$t"; \
    sed -i 's/ ipv6=off;/;/g' "$t"; \
    if grep -qF 'ipv6=off' "$t"; then echo "ipv6=off is still in $t" >&2; exit 1; fi; \
    grep -qF 'set $api_upstream http://${BACKEND}:${PORT};' "$t"; \
    grep -Eq '^[[:space:]]*worker_processes[[:space:]]' /etc/nginx/nginx.conf; \
    grep -q 'envsh' /docker-entrypoint.sh; \
    test -x /docker-entrypoint.d/20-envsubst-on-templates.sh; \
    nginx -V 2>&1 | grep -q -- '--with-http_realip_module'; \
    sh -n /docker-entrypoint.d/17-railway-opengym.envsh

# Back to the image's unprivileged nginx user (uid 101) for everything below and at runtime.
USER 101

ENV PORT=8080 \
    NGINX_PORT=8080 \
    RESOLVER=auto \
    NGINX_WORKER_PROCESSES=2 \
    OPENGYM_REAL_IP_HEADER=X-Real-IP

# Run the image's start-up chain once with stand-in values and let nginx check the rendered
# configuration (openGym's template, the real-IP file, the worker count). The files it writes are
# rewritten on every start; the real-IP file is removed so only a start creates it.
RUN BACKEND=opengym-api.railway.internal RESOLVER='[fd12::10] 127.0.0.1' /docker-entrypoint.sh nginx -t \
 && rm -f /etc/nginx/conf.d/00-railway-real-ip.conf

EXPOSE 8080
