#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?image tag required}"
PORT="${2:-8080}"
BIFROST_BASE_PATH="${BIFROST_BASE_PATH:-}"
BIFROST_ENV="${BIFROST_ENV:-}"
CONFIG_FILE="${3:-}"
CONTAINER_NAME="bifrost-prod-smoke-${GITHUB_RUN_ID:-local}"

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker run --rm --entrypoint test "${IMAGE}" -f /app/defaults/config.json; then
  echo "Image is missing baked-in /app/defaults/config.json"
  exit 1
fi
echo "Image contains /app/defaults/config.json"

CONFIG_MOUNT=()
if [[ -n "${CONFIG_FILE}" ]]; then
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "Config file not found: ${CONFIG_FILE}"
    exit 1
  fi
  CONFIG_MOUNT=(-v "${CONFIG_FILE}:/app/data/config.json:ro")
fi

docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:8080" \
  -e APP_PORT=8080 \
  -e APP_HOST=0.0.0.0 \
  -e BIFROST_ENV="${BIFROST_ENV}" \
  -e BIFROST_BASE_PATH="${BIFROST_BASE_PATH}" \
  "${CONFIG_MOUNT[@]}" \
  "${IMAGE}"

for attempt in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
    echo "Health check passed on attempt ${attempt}"
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "Health check failed after 60s"
    docker logs "${CONTAINER_NAME}" 2>&1 | tail -100
    exit 1
  fi
  sleep 2
done

if ! docker exec "${CONTAINER_NAME}" test -f /app/data/config.json; then
  echo "config.json missing at /app/data/config.json"
  docker logs "${CONTAINER_NAME}" 2>&1 | tail -100
  exit 1
fi

if [[ -z "${CONFIG_FILE}" ]] && ! docker exec "${CONTAINER_NAME}" test -f /app/defaults/config.json; then
  echo "Image default config missing at /app/defaults/config.json"
  exit 1
fi

if ! docker logs "${CONTAINER_NAME}" 2>&1 | grep -F "loading configuration from: /app/data/config.json" >/dev/null; then
  echo "Bifrost did not report loading /app/data/config.json"
  docker logs "${CONTAINER_NAME}" 2>&1 | tail -100
  exit 1
fi

echo "config.json loaded successfully from /app/data/config.json"
