#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?image tag required}"
PORT="${2:-8080}"
BIFROST_BASE_PATH="${BIFROST_BASE_PATH:-}"
CONTAINER_NAME="bifrost-prod-smoke-${GITHUB_RUN_ID:-local}"

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:8080" \
  -e APP_PORT=8080 \
  -e APP_HOST=0.0.0.0 \
  -e BIFROST_BASE_PATH="${BIFROST_BASE_PATH}" \
  "${IMAGE}"

for attempt in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
    echo "Health check passed on attempt ${attempt}"
    exit 0
  fi
  sleep 2
done

echo "Health check failed after 60s"
docker logs "${CONTAINER_NAME}" 2>&1 | tail -100
exit 1
