# Deploy and Host openGym with Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/opengym-v1-self-hosted-workout-tracker?referralCode=20H68q)

openGym is an open-source (AGPL-3.0) gym and body-weight tracker: plan routines, run guided workouts with supersets, warm-ups and cardio, see which muscles you trained and track your weight and PRs. This community template runs openGym 1.4.3 from the official images with an owner account and closed sign-up from the first request.

## About Hosting openGym

openGym has two parts: a Node API that keeps every account, passkey and workout as JSON files in one data directory, and an nginx front end that serves the installable web app and the exercise animations and proxies `/api` to the API on the same origin, which passkeys require. Hosting it well means HTTPS on a fixed host name, a persistent volume for the data directory, a proxy that can find the API, and a first account nobody else can claim. On a fresh openGym anyone who opens the URL can sign up. This template creates your owner (admin) profile from Railway variables before the API accepts requests, turns sign-up into invite-only and hides guest mode, so the instance is private from the start.

## Common Use Cases

- A private workout log for yourself, synced between your phone, tablet and laptop and installable as an app
- An invite-only instance for a training partner, family, a club or a small gym, each person with their own profile and data
- Moving your history out of Strong, Hevy or FitNotes onto a server you control, with CSV export when you want it back
- A self-hosted backend for the openGym iPhone and Android apps, paired with a one-time code

## Dependencies for openGym Hosting

- openGym web service (official `opengym-web` image): app shell, exercise media and `/api` proxy, public HTTPS domain
- openGym API service (official `opengym-api` image): accounts, sync, admin dashboard, uploads and push, private network only
- A Railway volume at `/data` on the API service for all openGym data (included)
- No database, no external API keys and no mail server needed. An AI provider key is optional, for the AI Coach

### Deployment Dependencies

- openGym repository: https://github.com/DuarteSantos8/openGym
- Release 1.4.3 notes: https://github.com/DuarteSantos8/openGym/releases/tag/v1.4.3
- Self-hosting guide (passkeys, password sign-in, backups, recovery codes): https://github.com/DuarteSantos8/openGym/blob/v1.4.3/docs/SELF_HOSTING.md
- Phone apps and pairing: https://github.com/DuarteSantos8/openGym/blob/v1.4.3/docs/MOBILE.md
- AI Coach: https://github.com/DuarteSantos8/openGym/blob/v1.4.3/docs/AI_COACH.md
- Live demo with example data: https://opengym.ch/demo/
- Railway volumes: https://docs.railway.com/volumes/reference
- Railway SSH: https://docs.railway.com/cli/ssh

### Implementation Details

| Service | Source | Purpose |
|---|---|---|
| openGym | `ghcr.io/duartesantos8/opengym-web:1.4.3` plus a start-up file (repo `baranberkay96/opengym-railway`, `services/web`) | nginx on port 8080, public domain, healthcheck `/api/health` through the proxy; serves the app and exercise media, proxies `/api` to the API |
| openGym API | `ghcr.io/duartesantos8/opengym-api:1.4.3` plus an owner-setup step (same repo, `services/api`) | Node API on port 8080, private network only, healthcheck `/api/health`; volume `/data` |

**First login**

1. Optional before deploying: set `OPENGYM_OWNER_NAME` on openGym API to your own name. openGym cannot rename a profile later; the default is `Owner`.
2. Deploy. On the first boot the API creates the owner profile (admin) with the generated `OPENGYM_OWNER_PASSWORD` before it accepts any request.
3. Open `https://{your-domain}`, choose **Sign in with password** and enter the owner name and the password from the openGym API service's Variables tab.
4. In **Settings, Account** add a passkey for this device and change the password if you like. The **Admin dashboard** link is there too.
5. Invite people: Admin dashboard, invite codes. Each code creates one profile. Sign-up without a code is refused.

**Access settings** (on openGym API): `INVITE_ONLY=0` opens sign-up to anyone with the URL, `ALLOW_GUEST=1` shows browser-only guest mode, `PASSWORD_LOGIN=0` makes it passkey-only (add a passkey to every profile first, or those profiles are locked out). The owner variables are read on the first boot only.

**Lost access?** An admin can give other profiles a reset or recovery code from the dashboard. For the owner, run `node /app/recover.js "Owner"` (use your owner name) in the openGym API service through `railway ssh`; it prints a one-time code for **Lost access? I have a code** on the sign-in screen.

**Custom domain**: add it to the openGym service, then set `RP_ID` to the bare host name and `ORIGIN` to `https://` plus the host name on openGym API, and redeploy. Passkeys are bound to the host name, so passkeys made on the old domain stop working; do this before inviting people, or have them sign in with their password and add a new passkey.

**Phone apps**: in a signed-in browser open Settings, Account, Pair the mobile app, and enter the code in the openGym app with `https://{your-domain}` as the server.

**Data and backups**: everything lives on the `/data` volume of openGym API (`db.json`, one state file per profile, `uploads/`, the session key and push keys). Turn on volume backups in the service's Backups tab. Each person can also export their own data as JSON or CSV in Settings, Data & backup.

**Uploads**: exercise and progress photos and videos are stored on the volume, 200 MB per profile (`MEDIA_QUOTA_MB`). Uploads stop when less than 200 MB is free (`MEDIA_MIN_FREE_MB`). Railway's edge allows 5 minutes per upload, enough for the 40 MB video limit on a normal mobile connection.

**AI Coach**: off until an admin turns it on in the dashboard and adds an API key (Anthropic, OpenAI, Gemini or an OpenAI-compatible endpoint). Keys are stored encrypted on the volume. `COACH_DISABLED=1` keeps it off for good.

**Scaling**: openGym API runs as one instance because its data are files on one volume. Give it more memory for many simultaneous sign-ins. The openGym service is stateless and needs very little.

**Pinning and upgrades**: both images come from `OPENGYM_VERSION` on the openGym service (default `1.4.3`); the API service follows it. Read the release notes, back up the volume, change the version and redeploy both services. The builds check that the new images still fit this template before anything is deployed.

### Why Deploy openGym on Railway?

Railway runs the web front end and the API in one project with HTTPS, private networking, a volume and backups, so you get your own workout tracker with passkey sign-in without managing a server. The template is closed to strangers from the first request, pinned to a known release, and your training history stays in a data directory you own.
