# openGym v1 Self-Hosted Workout Tracker: Railway template spec

## Listing

| Field | Value |
|---|---|
| Name | **openGym v1 Self-Hosted Workout Tracker** (given name, unchanged; "v1" = major version of the pinned 1.4.3) |
| Description | Plan routines, log workouts and track body weight on your own server. (69 chars, unchanged) |
| Category | Other |
| Tags | opengym, fitness, workout-tracker, gym, body-weight, passkeys, pwa, self-hosted |
| Icon | `https://cdn.jsdelivr.net/gh/DuarteSantos8/openGym@v1.4.3/frontend/public/icon-512.png` (200, image/png, upstream's app icon at the release tag) |

The description is delivered as written: routines (weekly plan, rotations), workout logging (supersets, warm-ups, drops, cardio) and body weight tracking are all part of openGym 1.4.3, and everything is stored on the template's own volume.

## Base market template

- **"openGym"** (code `opengym`, 2 active projects, created 2026-10-04) is the only market template. One service from a third-party image `ghcr.io/youssefsiam38/opengym-railway:1.0.1` (amd64 only, built 2026-10-04, image label version `0.0.0-local`): openGym's API and nginx in one container, volume `/storage`, healthcheck `/api/health`, `PORT=8080`, `RP_ID`/`ORIGIN` from the Railway domain, an owner profile seeded on first boot from `OWNER_NAME`/`OWNER_PASSWORD` (generated), `INVITE_ONLY=1`, `ALLOW_GUEST=0`, `PASSWORD_LOGIN=1`, `TRUST_PROXY=1`, and `EXERCISE_MEDIA=download`, which fetches about 140 MB of exercise media from GitHub on first start.
- Kept: the access model (owner created before anyone else can sign up, invite-only, no guest door, password sign-in on so the owner can get in), passkey domain wiring, `TRUST_PROXY` with the visitor address restored from Railway's edge, `/api/health`.
- Its image was built before openGym 1.4.0 (released 2026-10-09), the release that moved the exercise media into the official web image, so it runs openGym 1.3.9 or older. Its source repository was not available here; nothing from it was read or copied.

## Upstream layout and what changed for Railway

Upstream (`docker-compose.yml` at tag `v1.4.3`) runs two containers: `api` (Node, `node server.js`, all data as JSON files in `DATA_DIR=/data`) and `web` (nginx serving the built React app and the exercise media, proxying `/api` to `api` on one origin, which passkeys require). There is **no database**: openGym stores accounts, passkeys, invites and each profile's state in files (`db.json`, `state-{uid}.json`, `uploads/`, `secret`, `vapid.json`, `audit.log`). Postgres is not supported, so the template has none.

This template keeps that layout as two Railway services built from the official images:

```
            Internet (HTTPS, Railway edge, sets X-Real-IP)
                           │
                           ▼
     ┌──────────────────────────────────────────┐  healthcheck GET /api/health
     │ openGym  :8080  (nginx, uid 101)          │  (through the proxy, so it proves
     │  app shell, exercise media (in image),    │   DNS + API are reachable)
     │  /api/* → BACKEND:PORT, resolver = auto   │  no volume, stateless
     └────────────────────┬─────────────────────┘
                          │ http://opengym-api.railway.internal:8080 (private network)
                          ▼
     ┌──────────────────────────────────────────┐  healthcheck GET /api/health
     │ openGym API  :8080 (Node 22, root)        │  (503 if /data is not writable)
     │  passkeys, passwords, sync, admin, push,  │  volume /data
     │  uploads, AI Coach (off until an admin    │   db.json, state-*.json, uploads/,
     │  connects a provider)                     │   secret, vapid.json, audit.log
     └──────────────────────────────────────────┘
```

Both services listen on **8080**. openGym's web image uses `PORT` for the API's port (the value it proxies to), while Railway's healthcheck probes `PORT` on every service; giving the API port 8080 and nginx `NGINX_PORT=8080` makes both meanings agree.

### Owner bootstrap (sign-up closed from the first request)

The API service's entrypoint (`services/api/railway-entrypoint.sh`) runs `seed-owner.mjs` before `exec node server.js`:

1. Reads `$DATA_DIR/db.json`. If it has any profile, it logs the count and does nothing (`OPENGYM_OWNER_*` are ignored after the first boot). If `db.json` is unparsable or only `db.json.bak` exists, it does nothing and leaves recovery to openGym (which falls back to the backup or refuses to start).
2. Otherwise validates `OPENGYM_OWNER_NAME` (1-40 chars, no control characters), `OPENGYM_OWNER_PASSWORD` (openGym's own `passwordProblem()`: 10-256 chars, not a common password, not the name plus digits) and the optional `OPENGYM_OWNER_EMAIL` (openGym's `normalizeEmail()`). Bad input exits 1, so the API never starts with an unusable owner.
3. Hashes the password with openGym's `hashPassword()` (scrypt, N=2^15) and writes `{id, name, created, pw:{h,set}, email?, admin:true, owner:true}` with openGym's `atomicWrite()` (temp file, fsync, rename, mode 0600) to `db.json` and `db.json.bak`, the same shape `POST /api/register/password` gives the first profile under `FIRST_USER_ADMIN=1`.

The port opens only after this, and `INVITE_ONLY=1` means every further profile needs an invite code that only the owner (or admins they appoint) can create. `ALLOW_GUEST=0` removes the browser-only guest button. `FIRST_USER_ADMIN` is not needed and stays unset.

The Docker build runs `seed-owner.mjs --self-test` against the real modules in the image: owner created, password verified with openGym's `verifyPassword()`, wrong password refused, file modes, a second boot changes nothing, other collections are kept, a broken or backup-only data directory is left alone, and weak passwords, empty names and bad e-mails are refused.

### Web service adjustments (`services/web/`)

The official web image plus `/docker-entrypoint.d/17-railway-opengym.envsh`, sourced by nginx's entrypoint just before openGym's config template is rendered:

- **Resolver.** openGym's nginx resolves `BACKEND` on every request through `RESOLVER`, default Docker's `127.0.0.11`, which does not exist on Railway. `RESOLVER=auto` takes the name servers from `/etc/resolv.conf` (IPv6 in brackets).
- **IPv6.** The Dockerfile removes `ipv6=off` from openGym's two `resolver` lines, so the API's private domain resolves on Railway networks that only publish an IPv6 address; the API listens on `::` (dual stack). New environments publish both, so this only matters for older projects.
- **Visitor address.** Railway's edge documents `X-Real-IP` as the client address. The script writes `set_real_ip_from 0.0.0.0/0; set_real_ip_from ::/0; real_ip_header X-Real-IP;` into `conf.d`, so openGym's own `X-Forwarded-For $remote_addr` carries the visitor, and the API (with `TRUST_PROXY=1`) throttles password attempts per visitor instead of per edge address. `OPENGYM_REAL_IP_HEADER=off` restores upstream's behaviour.
- **Workers.** `worker_processes auto` would start one worker per host CPU (dozens on Railway); `NGINX_WORKER_PROCESSES=2`.
- `BACKEND`, `RESOLVER` and the header name are validated (host names and addresses only) because they end up unquoted in nginx's config; bad values stop the container with a clear message.

The Docker build checks that the upstream template still has the lines it edits, that nginx has the realip module, and then runs the image's whole start-up chain once with stand-in values followed by `nginx -t`, so a broken render fails the build, not the deploy.

## Pinned versions

| Service | Image / source | Tag | Release date | Checked |
|---|---|---|---|---|
| openGym | repo `baranberkay96/opengym-railway`, `/services/web` → `FROM ghcr.io/duartesantos8/opengym-web:${OPENGYM_VERSION}` | `1.4.3` (index `sha256:e77ef879…f8b512`, amd64 + arm64, label revision `7c8290ca`) | 2026-10-26 | 2026-10-30 |
| ↳ base of that image | `nginxinc/nginx-unprivileged:1.30.6-alpine` | as built by upstream | | 2026-10-30 |
| openGym API | repo `baranberkay96/opengym-railway`, `/services/api` → `FROM ghcr.io/duartesantos8/opengym-api:${OPENGYM_VERSION}` | `1.4.3` (index `sha256:21d1fde3…ceae16`, amd64 + arm64, label revision `7c8290ca`, default target: no AI agent runtime) | 2026-10-26 | 2026-10-30 |
| ↳ base of that image | `node:22.23.4-alpine` | as built by upstream | | 2026-10-30 |

`OPENGYM_VERSION` is set once on the openGym service; the API service references it (`${{openGym.OPENGYM_VERSION}}`), so both images always come from the same release, as upstream requires.

## Services

### openGym (web, public)
- Source: repo `baranberkay96/opengym-railway`, root `/services/web` (Dockerfile). Start command: none (image entrypoint `/docker-entrypoint.sh nginx -g 'daemon off;'`).
- Healthcheck `/api/health`, timeout 900 s: it passes through nginx to the API, so it waits for the API's first deploy and its private DNS entry (Railway registers a service's private name only after its own healthcheck passes).
- Public domain, target port 8080. No TCP proxy. No volume. Restart ON_FAILURE, 10 retries. 1 replica (stateless; more replicas are possible in the dashboard).
- Runs as uid 101 (upstream's unprivileged nginx).

| Variable | Value | Description |
|---|---|---|
| PORT | `8080` | Railway's probe port, and in openGym's web image the API port it proxies to. |
| NGINX_PORT | `8080` | nginx listen port; keep equal to PORT. |
| BACKEND | `${{openGym API.RAILWAY_PRIVATE_DOMAIN}}` | API host for `/api`. |
| RESOLVER | `auto` | DNS server for BACKEND; auto = `/etc/resolv.conf`. |
| OPENGYM_VERSION | `1.4.3` | Release for both images (build argument). |
| MEDIA_UPLOAD_MAX | `48m` | nginx body cap on `/api/media/`; above the API's 40 MB video cap. |
| OPENGYM_REAL_IP_HEADER | `X-Real-IP` | Header with the visitor address; `off` disables. |
| NGINX_WORKER_PROCESSES | `2` | nginx workers. |

Image defaults not exposed: `BASE_PATH=` (served at the root), `CF_CONNECTING_IP=` (header dropped), `CONTENT_SECURITY_POLICY` (upstream's).

### openGym API (private)
- Source: repo `baranberkay96/opengym-railway`, root `/services/api` (Dockerfile). Start command: none (entrypoint `railway-opengym-entrypoint.sh`, CMD `node server.js`). No pre-deploy command: openGym has no migrations; files are upgraded by the server itself.
- Healthcheck `/api/health` (200 with `{"ok":true,"users":N,"writable":true}`; 503 when `/data` is not writable), timeout 300 s.
- No public domain, no TCP proxy. Volume `/data` (template requests DAILY and WEEKLY backups). Restart ON_FAILURE, 10 retries. 1 replica: the data are files on one volume and two API processes must never write them at once.
- Runs as root like upstream's image (the AI Coach drops its jobs to the image's `coach` user, which needs root; `node recover.js` talks to the server's root-only admin socket).

| Variable | Value | Description |
|---|---|---|
| PORT | `8080` | API listen port (`::`, dual stack). |
| DATA_DIR | `/data` | All openGym data; on the volume. |
| RP_ID | `${{openGym.RAILWAY_PUBLIC_DOMAIN}}` | Passkey host name. |
| ORIGIN | `https://${{openGym.RAILWAY_PUBLIC_DOMAIN}}` | Origin checked on sign-in and sync. |
| RP_NAME | `openGym` | Name in the passkey prompt. |
| OPENGYM_OWNER_NAME | `Owner` | First-boot owner profile name (permanent: openGym has no rename). |
| OPENGYM_OWNER_PASSWORD | `${{secret(24, "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")}}` | First-boot owner password. |
| OPENGYM_OWNER_EMAIL | *(empty)* | Optional sign-in e-mail for the owner. |
| INVITE_ONLY | `1` | Sign-up closed; invite codes from the admin dashboard. |
| ALLOW_GUEST | `0` | No browser-only guest mode. |
| PASSWORD_LOGIN | `1` | Name/e-mail + password sign-in next to passkeys. |
| TRUST_PROXY | `1` | Per-visitor sign-in throttle from the headers nginx overwrites. |
| SESSION_DAYS | `90` | Sign-in lifetime (upstream default). |
| AUDIT_IP | `off` | Addresses in the activity log: off, net, full (upstream default off). |
| DEFAULT_LANG | *(empty)* | Optional default language. |
| MEDIA_QUOTA_MB | `200` | Upload space per profile (upstream default). |
| MEDIA_MIN_FREE_MB | `200` | Free-space floor for uploads (upstream 512; lowered for Railway's 0.5 GB Trial / 5 GB Hobby volumes). |
| VAPID_SUBJECT | *(empty)* | Push contact; empty = ORIGIN. |
| COACH_DISABLED | `0` | 1 = AI Coach can never be turned on. |
| OPENGYM_VERSION | `${{openGym.OPENGYM_VERSION}}` | Same release as the web service. |

Other upstream variables (`ADMIN_UIDS`, `AUDIT_LOG`, `AUDIT_MAX`, `AUDIT_DAYS`, `MEDIA_UPLOADS`, `MEDIA_*_MAX_MB`, `MEDIA_VIDEO_MAX_SEC`, `MEDIA_GC_GRACE_DAYS`, `MEDIA_UPLOADS_PER_HOUR`, `COACH_JOB_TIMEOUT_MS`, `ALLOWED_PRIVATE_IPS`) keep openGym's defaults and can be added on the API service.

## Improvements over market templates

1. **Official images, current release.** Built `FROM` openGym's own `opengym-api` and `opengym-web` 1.4.3 images (released 2026-10-26) instead of a third-party combined image built before openGym 1.4.0. One variable (`OPENGYM_VERSION`) upgrades both services in lockstep; the build fails early if a new release no longer fits the wrapper.
2. **Upstream's two-container layout.** The API is private (no public port; only the web service talks to it) and owns the volume; the web service is stateless. Matches upstream's two-container compose stack and keeps the official images' own users (nginx as uid 101).
3. **No first-boot download.** Exercise images and animations ship inside the official web image since 1.4.0; the market template downloads about 140 MB from GitHub on first start (a GitHub dependency at boot, and a copy of licensed third-party media on the volume).
4. **Owner setup fails closed and is tested at build.** The owner is validated against openGym's own password and e-mail rules before the port opens, written exactly the way the server writes `db.json` (plus `db.json.bak`), never touches a data directory that already has profiles or only a backup, and the logic is self-tested against the real image modules during the build.
5. **nginx made for Railway's network.** Resolver taken from `/etc/resolv.conf` instead of Docker's `127.0.0.11`, IPv6 lookups allowed for older IPv6-only private networks, and 2 workers instead of one per host CPU.
6. **Healthchecks that prove the app works.** The API's checks that the volume is writable; the web's goes through nginx's proxy and DNS to the API.
7. **Sized for Railway volumes.** `MEDIA_MIN_FREE_MB=200` instead of 512, so uploads still work on a 0.5 GB Trial volume while state saves keep headroom; daily and weekly volume backups requested.
8. **Recovery documented.** `railway ssh` into the API service and `node /app/recover.js "{name}"` gives a one-time code when the owner loses every way in.
9. Every variable described, including the custom-domain steps for `RP_ID`/`ORIGIN` and what changing them does to existing passkeys.

## Resource estimate

Not measured (no Docker run). Estimates from the stack: a single Node process with JSON files (scrypt password checks use 32 MiB each, at most two at once) and nginx with two workers serving static files.

| Service | Idle RAM | Typical RAM | Typical vCPU | Volume |
|---|---|---|---|---|
| openGym (nginx) | ~15 MB | 20-40 MB | <0.01 | none |
| openGym API (Node) | ~80-100 MB | 120-200 MB (spikes during sign-ins and uploads) | 0.01-0.05 | 10-100 MB of JSON + uploads (up to 200 MB per profile) |
| **Total** | **~0.12 GB, ~0.005 vCPU** | **~0.2 GB, ~0.03 vCPU** | | **0.1-3 GB** |

At Railway prices (RAM $10/GB-month, vCPU $20/vCPU-month, volume $0.15/GB-month):
- Idle / just deployed: 0.12 × 10 + 0.005 × 20 + 0.1 × 0.15 ≈ **$1.3 / month**.
- Typical (one person to a small group logging workouts daily, some photos): 0.2 × 10 + 0.03 × 20 + 2 × 0.15 ≈ **$3 / month**.
- A larger group with many progress videos is driven by the volume: 20 profiles at the full 200 MB quota ≈ 4 GB ≈ $0.60/month more.

Minimum plan: **Trial** runs it (both services well under 1 GB RAM; the 0.5 GB Trial volume holds the data, uploads stop at 200 MB free). **Hobby** recommended for regular use (5 GB volume). Pro only for very large media libraries.

## Verification checklist

1. Both builds pass. Web build log: the start-up chain ends with `nginx: configuration file /etc/nginx/nginx.conf test is successful`. API build log: `[railway-opengym] owner bootstrap self-test passed`.
2. API deploy log, in order: `created the owner profile "Owner" (admin and owner, id …)`, `starting openGym API 1.4.3 on port 8080 (RP_ID=…up.railway.app)`, `gym-api on :8080 (rpID=…, origin=https://…)`. No warnings about the volume or ORIGIN.
3. Web deploy log: `17-railway-opengym.envsh: API upstream http://opengym-api.railway.internal:8080, resolver [fd12::10] …, 2 worker(s), real-IP header X-Real-IP` (the resolver address is whatever Railway puts in `/etc/resolv.conf`).
4. `curl https://{domain}/api/health` → `{"ok":true,"users":1,"writable":true}`. `curl https://{domain}/api/config` shows `"invite_only":true,"allow_guest":false,"password_login":true`.
5. Sign-up is closed: `curl -si -X POST https://{domain}/api/register/password -H 'Content-Type: application/json' -d '{"name":"intruder","password":"a-long-enough-pass-123"}'` → 403 `a valid invite code is required`.
6. Open `https://{domain}`: no "Continue without account". Sign in with password: name `Owner`, password from `OPENGYM_OWNER_PASSWORD`. Settings, Account shows the Admin dashboard. Add a passkey (proves `RP_ID`/`ORIGIN`). Create an invite code; in a private window create a second profile with it; the code is used up.
7. Log a workout with a superset and warm-up sets, add a body weight entry, upload a progress photo; reload on a second device (or private window) signed in as the owner: data synced. Exercise animations load from `/exercise-media/`.
8. Real visitor address: set `AUDIT_IP=full` on the API, sign in with a wrong password, check the activity log shows your public IP, not a Railway-internal one. Then send `curl -H 'X-Real-IP: 203.0.113.9'` with a wrong password and check whether the log shows 203.0.113.9 (it should not if Railway's edge overwrites the header; see Open questions). Set `AUDIT_IP=off` again.
9. Redeploy the API: log says `1 profile(s) on this instance; … OPENGYM_OWNER_* are not used`; sessions survive (the `secret` file is on the volume); data and the photo are still there. Redeploy the web service alone: healthcheck passes immediately.
10. Recovery: `railway ssh` into openGym API, `node /app/recover.js "Owner"` prints a one-time code.
11. Optional: pair the iOS/Android app (Settings, Account, Pair the mobile app) against `https://{domain}`.

## Open questions

- Nothing was built or run (no Docker by instruction). The Railway build is the first build: the `COPY --chmod` lines, the build-time `nginx -t` run of the entrypoint chain as uid 101, and the API self-test inside the image are unverified. The seed script's logic was run locally against openGym 1.4.3's real `password.js`/`durable.js` (self-test plus six entrypoint scenarios), and the web script under `dash` with a harness that mimics nginx's entrypoint (sourcing in a piped loop under `set -eu`), with a shim for BusyBox's `sed -i`.
- Whether Railway's edge overwrites a client-supplied `X-Real-IP` (its docs only say the header identifies the client). If it passes one through, a client could choose the address the per-address throttle and the activity log see; per-account password throttling is unaffected. Checklist item 8 tests it; `OPENGYM_REAL_IP_HEADER=off` is the fallback.
- That the API's private DNS name resolves through the resolver in `/etc/resolv.conf` from nginx (same approach as other templates in this repository; not tested here).
- Whether Railway passes `OPENGYM_VERSION` (a reference on the API service) into the `ARG` before `FROM`. If not, both Dockerfiles default to `1.4.3`, which is correct.
- `backupSchedules` on the API volume is in `template.json`, but `_tools/to_serialized.py` only passes `mountPath`; enable backups by hand or extend the tool.
- Changing `RP_ID` later (custom domain) invalidates every passkey made under the old host name; profiles then need their password or a recovery code. The README says to add the custom domain before inviting people.
- Exercise media license (Gym visual, see NOTICE.md): the media ship unmodified inside openGym's own image, which upstream allows for self-hosted servers. Whether a template that earns Railway's template revenue share counts as "commercial use" under Gym visual's terms is a question for the template owner.
- RAM/CPU figures are estimates.
