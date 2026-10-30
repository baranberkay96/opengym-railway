# NOTICE: openGym template

This Railway template is a community package. It is not affiliated with, sponsored by or endorsed by Duarte Santos or the openGym project. "openGym" and its icon (loaded from the `v1.4.3` tag through jsDelivr) are used only to identify the software the template deploys.

## Software deployed

| Component | Source | License | How it is used |
|---|---|---|---|
| openGym API 1.4.3 | `ghcr.io/duartesantos8/opengym-api:1.4.3` (index `sha256:21d1fde39470d9c91424db51be64f5dd57c75b0b493345016f1d6e268dceae16`, built 2026-10-26 from https://github.com/DuarteSantos8/openGym tag `v1.4.3`, commit `7c8290ca20cb619bf6baa6830ea864d283df305a`) | GNU AGPL v3.0 or later, Copyright (C) 2026 Duarte Santos | Base image of the openGym API service. No openGym file is changed; the wrapper adds an entrypoint and `seed-owner.mjs`. |
| openGym web 1.4.3 | `ghcr.io/duartesantos8/opengym-web:1.4.3` (index `sha256:e77ef879d10549acc88a888e0cd4d566592c5680bee6436b05071678fcf8b512`, same tag and commit) | GNU AGPL v3.0 or later; exercise media under their own terms (below) | Base image of the openGym service. The Dockerfile removes ` ipv6=off` from the two `resolver` lines of openGym's `web/nginx.conf.template` inside the image (a configuration change, see the AGPL notes) and adds a start-up file. |
| Inside those images | Node.js 22.23.4 on Alpine (`node:22.23.4-alpine`), nginx 1.30.6 (`nginxinc/nginx-unprivileged:1.30.6-alpine`), openGym's npm dependencies (`@simplewebauthn/server`, `web-push`, `undici`, the built React app and its libraries) | Their own licenses, as shipped by upstream (openGym's NOTICE.md lists the third-party code inside the app: MuscleMap and ExerciseDB-derived exercise text under MIT, lean-qr under MIT, jsQR and the ML Kit plugin under Apache-2.0) | Unchanged. |

### Exercise media (Gym visual)

The exercise stills and animations inside the official web image (`/usr/share/nginx/html/exercise-media/`, 180 px) are licensed to openGym by Gym visual and are **not** covered by openGym's AGPL. Upstream's NOTICE.md (tag `v1.4.3`) says self-hosted servers carry them at 180 px at most, that they may not be extracted, hotlinked, reused outside openGym or used to train or feed AI systems, and that "© Aliaksandr Makatserchyk, Gym visual, gymvisual.com" applies. This template serves them unmodified, only as part of the openGym app, from openGym's own image; it does not copy, download or redistribute them separately. Read openGym's NOTICE.md before reusing them in any other way: https://github.com/DuarteSantos8/openGym/blob/v1.4.3/NOTICE.md

## AGPL-3.0 notes

- **Corresponding source of what runs.** openGym's own code runs unmodified from the official images; its complete source is the upstream tag `v1.4.3` (https://github.com/DuarteSantos8/openGym/tree/v1.4.3). The only change to an openGym file is the `sed` in `services/web/Dockerfile` that removes ` ipv6=off` from the nginx template; that Dockerfile, the start-up file and the API wrapper in this repository are the rest of the source of the deployed images. Keep this repository public while the template is published.
- **Wrapper license.** `services/api/seed-owner.mjs` imports openGym's `password.js` and `durable.js` into its own process, and both images are built on openGym's, so the wrapper files (`services/api/*`, `services/web/*`) are offered under the same license, AGPL-3.0-or-later.
- **If you modify openGym** in your own deployment (patching files in the image or building from a fork), AGPL-3.0 section 13 requires you to offer the modified source to everyone who uses your instance over the network.
- AGPL-3.0 text: https://github.com/DuarteSantos8/openGym/blob/v1.4.3/LICENSE

These notes describe how the template is put together; they are not legal advice.

## What this package adds (original work)

- `services/api/Dockerfile`: `FROM` the official API image, adds the two files below, build-time checks and a self-test, `ENTRYPOINT`.
- `services/api/railway-entrypoint.sh`: checks the volume, `RP_ID` and `ORIGIN`, runs the owner setup, then execs upstream's unchanged `node server.js`.
- `services/api/seed-owner.mjs`: creates the owner profile on an instance without profiles, using openGym's own `hashPassword`, `passwordProblem`, `normalizeEmail` and `atomicWrite`; no openGym code is copied into it.
- `services/web/Dockerfile`: `FROM` the official web image, the `ipv6=off` edit, build-time checks and an `nginx -t` run of the full start-up chain.
- `services/web/17-railway-opengym.envsh`: resolver from `/etc/resolv.conf`, visitor address from Railway's `X-Real-IP`, nginx worker count, input checks.
- `template.json`, `TEMPLATE.md`, `README.md`, this file.

## Upstream material checked (openGym `v1.4.3`, 2026-10-30)

Read through the GitHub contents API at tag `v1.4.3` (no local copy; nothing copied):

- `docker-compose.yml`, `.env.example`, `.dockerignore`, `api/Dockerfile`, `api/package.json`, `web/Dockerfile`, `web/nginx.conf.template`, `web/05-check-base-path.sh`, `NOTICE.md`, `LICENSE`, `README.md`, `CHANGELOG.md` (v1.4.3, v1.4.0 notes).
- `api/server.js` (configuration variables, db.json load and save, owner and admin rules, password registration and sign-in, `/api/health`, `/api/config`, origin check, listener), `api/password.js`, `api/durable.js`, `api/recover.js`, `api/admin-socket.js`, `api/coach/config.js`.
- `docs/SELF_HOSTING.md` (passkeys, multiple users, password sign-in, uploads, backups, notifications, updating, recovery codes), `docs/SELF_HOSTING_KUBERNETES.md`.
- `nginx/docker-nginx-unprivileged` (stable): `docker-entrypoint.sh` (sourcing of `.envsh` files), `15-local-resolvers.envsh`, `20-envsubst-on-templates.sh`, `10-listen-on-ipv6-by-default.sh`, the alpine Dockerfiles.
- Registry: GHCR tag lists and image configs of both 1.4.3 images (API: no USER, entrypoint `docker-entrypoint.sh`, CMD `node server.js`, `PORT=3000`; web: USER 101, `NGINX_PORT=80`, `PORT=3000`, `RESOLVER=127.0.0.11`; both labelled revision `7c8290ca` and version 1.4.3).
- Railway: https://docs.railway.com/networking/public-networking/specs-and-limits (`X-Real-IP`, 5-minute upload limit).

## Market template reviewed (ideas only, nothing copied)

| Template | Use |
|---|---|
| "openGym" (marketplace code `opengym`, image `ghcr.io/youssefsiam38/opengym-railway:1.0.1`) | Its marketplace configuration and README were read for the starting point: owner seeded on first boot, invite-only, guest mode off, password sign-in on, passkey domain from Railway, visitor address from Railway's edge. Its image configuration (labels, environment) was inspected through the registry. Its source repository was not available and nothing from it or its README was used. |

All template files were written for this package.
