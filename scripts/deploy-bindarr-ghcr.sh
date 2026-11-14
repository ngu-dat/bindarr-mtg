#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/bindarr
ROLLBACK_TAG=bindarr-rollback:previous
LOCK_FILE=/run/lock/bindarr-ghcr-deploy.lock
IMAGE=${BINDARR_IMAGE:-ghcr.io/ngu-dat/bindarr-mtg:edge}

if [[ ! $IMAGE =~ ^ghcr\.io/ngu-dat/bindarr-mtg:(edge|sha-[0-9a-f]{7})$ ]]; then
  echo "Refusing unsupported Bindarr image reference: $IMAGE" >&2
  exit 2
fi

if [[ ! -f "$APP_DIR/docker-compose.yml" || ! -f "$APP_DIR/docker-compose.override.yml" ]]; then
  echo "Bindarr Compose files are missing from $APP_DIR." >&2
  exit 2
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo 'Another Bindarr deployment is already running.' >&2
  exit 1
fi

compose() {
  local image=$1
  shift
  BINDARR_IMAGE="$image" docker compose \
    --project-directory "$APP_DIR" \
    -f "$APP_DIR/docker-compose.yml" \
    -f "$APP_DIR/docker-compose.override.yml" \
    "$@"
}

wait_for_healthy() {
  for _ in $(seq 1 90); do
    local status
    status=$(docker inspect --format '{{.State.Health.Status}}' bindarr 2>/dev/null || true)
    if [[ $status == healthy ]]; then return 0; fi
    sleep 2
  done
  return 1
}

echo "Creating a pre-deploy backup before switching to $IMAGE."
docker exec -i bindarr node - <<'NODE'
const crypto = require('crypto');
const db = require('./src/db');
const { hashSessionToken } = require('./src/utils/authHelpers');
(async () => {
  let tokenHash;
  let exitCode = 0;
  try {
    const admin = await db.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    if (!admin) throw new Error('No administrator account exists for the pre-deploy backup.');
    const token = crypto.randomBytes(32).toString('hex');
    tokenHash = hashSessionToken(token);
    await db.run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATETIME('now', '+5 minutes'))", [tokenHash, admin.id]);
    const response = await fetch('http://127.0.0.1:3001/api/admin/backups', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const backup = await response.json();
    if (!response.ok || !backup.file) throw new Error(backup.error || `Backup endpoint returned ${response.status}`);
    console.log(`Pre-deploy backup created: ${backup.file}`);
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    if (tokenHash) await db.run('DELETE FROM sessions WHERE token = ?', [tokenHash]).catch(() => {});
    await new Promise(resolve => db.dbConnection.close(() => resolve()));
  }
  if (exitCode) process.exitCode = exitCode;
})();
NODE

previous_image=$(docker inspect --format '{{.Image}}' bindarr)
docker image tag "$previous_image" "$ROLLBACK_TAG"

echo "Pulling $IMAGE."
if ! compose "$IMAGE" pull bindarr; then
  echo 'Image pull failed; the running Bindarr container was left untouched.' >&2
  exit 1
fi

echo 'Recreating Bindarr from the published image.'
if compose "$IMAGE" up -d --no-build bindarr && wait_for_healthy; then
  echo "Bindarr is healthy on $IMAGE."
  exit 0
fi

echo "The new image did not become healthy; rolling back to $ROLLBACK_TAG." >&2
compose logs --tail=100 bindarr >&2 || true
if compose "$ROLLBACK_TAG" up -d --no-build bindarr && wait_for_healthy; then
  echo 'Rollback restored the previous healthy Bindarr container.' >&2
else
  echo 'Rollback did not restore a healthy container; inspect Docker and Compose logs.' >&2
  compose logs --tail=150 bindarr >&2 || true
fi
exit 1
