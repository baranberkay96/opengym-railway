#!/bin/sh
# openGym API on Railway (community template, not affiliated with openGym).
#
#   1. checks the data directory (the Railway volume), RP_ID and ORIGIN;
#   2. seed-owner.mjs: on an instance without any profile, creates the owner (admin) from
#      OPENGYM_OWNER_NAME / OPENGYM_OWNER_PASSWORD with openGym's own password code;
#   3. execs openGym's unchanged command, `node server.js`.
# The API port opens only after step 2, so nobody can claim a fresh instance before its owner.
#
# Runs as root, like upstream's image: the AI Coach drops its jobs to the image's `coach` user,
# which needs root, and `node recover.js` reaches the server's admin socket as the same user.
set -eu

log() { printf '[railway-opengym] %s\n' "$*"; }
warn() { printf '[railway-opengym] WARNING: %s\n' "$*" >&2; }
fail() { printf '[railway-opengym] ERROR: %s\n' "$*" >&2; exit 1; }

truthy() {
  case "${1:-}" in
    1 | [Tt][Rr][Uu][Ee] | [Yy][Ee][Ss] | [Oo][Nn]) return 0 ;;
    *) return 1 ;;
  esac
}

cd /app
if [ "$#" -eq 0 ]; then
  set -- node server.js
fi

DATA_DIR=${DATA_DIR:-/data}
export DATA_DIR

check_storage() {
  volume=${RAILWAY_VOLUME_MOUNT_PATH:-}
  if [ -z "$volume" ]; then
    warn "no Railway volume is attached: profiles, workouts and uploads are lost on every redeploy. Attach a volume at $DATA_DIR."
  else
    case "$DATA_DIR" in
      "$volume" | "$volume"/*) ;;
      *) warn "DATA_DIR=$DATA_DIR is outside the volume at $volume: everything in it is lost on redeploy." ;;
    esac
  fi
  mkdir -p "$DATA_DIR" || fail "cannot create DATA_DIR=$DATA_DIR"
}

check_origin() {
  [ -n "${RP_ID:-}" ] || fail "RP_ID is empty. It must be the hostname people open openGym on: the openGym service's public domain, or your custom domain."
  [ -n "${ORIGIN:-}" ] || fail "ORIGIN is empty. It must be https:// followed by that hostname."
  case "$ORIGIN" in
    https://*) ;;
    *) warn "ORIGIN=$ORIGIN is not https: passkeys and secure session cookies need https." ;;
  esac
  host=${ORIGIN#*://}
  host=${host%%/*}
  host=${host%%:*}
  case "$host" in
    "$RP_ID" | *."$RP_ID") ;;
    *) warn "ORIGIN ($ORIGIN) is not on RP_ID ($RP_ID): passkey sign-in will fail. Set both to the domain people use." ;;
  esac
}

check_access() {
  truthy "${INVITE_ONLY:-}" || warn "INVITE_ONLY is off: anyone who can open the site can create a profile on it."
  truthy "${PASSWORD_LOGIN:-}" || log "PASSWORD_LOGIN is off: profiles sign in with passkeys only (a profile without a passkey needs a recovery code)."
}

check_storage
check_origin
check_access

node /app/railway/seed-owner.mjs || fail "owner setup failed (see the lines above); openGym was not started."

version=$(node -p 'require("/app/package.json").version' 2>/dev/null || echo unknown)
log "starting openGym API $version on port ${PORT:-3000} (RP_ID=$RP_ID)"
exec "$@"
