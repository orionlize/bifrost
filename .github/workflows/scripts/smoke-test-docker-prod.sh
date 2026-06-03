#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?image tag required}"
PORT="${2:-8080}"
BIFROST_BASE_PATH="${BIFROST_BASE_PATH:-}"
CONFIG_FILE="${3:-}"
CONTAINER_NAME="bifrost-prod-smoke-${GITHUB_RUN_ID:-local}"
REDIS_NAME="${CONTAINER_NAME}-redis"

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker rm -f "${REDIS_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker run --rm --entrypoint test "${IMAGE}" -f /app/defaults/config.json; then
  echo "Image is missing baked-in /app/defaults/config.json"
  exit 1
fi
echo "Image contains /app/defaults/config.json"

# config.json uses localhost:6379 for vector_store (same as repo config.json).
docker run -d \
  --name "${REDIS_NAME}" \
  -p 6379:6379 \
  redis:7-alpine >/dev/null

for attempt in $(seq 1 15); do
  if docker exec "${REDIS_NAME}" redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "Redis ready on attempt ${attempt}"
    break
  fi
  if [[ "${attempt}" -eq 15 ]]; then
    echo "Redis failed to become ready"
    docker logs "${REDIS_NAME}" 2>&1 | tail -50
    exit 1
  fi
  sleep 1
done

CONFIG_MOUNT=()
if [[ -n "${CONFIG_FILE}" ]]; then
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "Config file not found: ${CONFIG_FILE}"
    exit 1
  fi
  CONFIG_MOUNT=(-v "${CONFIG_FILE}:/app/data/config.json:ro")
fi

# Host networking so localhost:6379 inside the container reaches the Redis sidecar.
docker run -d \
  --name "${CONTAINER_NAME}" \
  --network host \
  -e APP_PORT="${PORT}" \
  -e APP_HOST=0.0.0.0 \
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

if ! docker logs "${CONTAINER_NAME}" 2>&1 | grep -Fq "Seeding /app/data/config.json from /app/defaults/config.json"; then
  if [[ -n "${CONFIG_FILE}" ]]; then
    echo "Using mounted config.json override"
  else
    echo "Expected entrypoint to seed /app/data/config.json from image default"
    docker logs "${CONTAINER_NAME}" 2>&1 | tail -100
    exit 1
  fi
fi

if ! docker logs "${CONTAINER_NAME}" 2>&1 | grep -Fq "loading configuration from: /app/data/config.json"; then
  echo "config.json was not loaded from /app/data/config.json"
  docker logs "${CONTAINER_NAME}" 2>&1 | tail -100
  exit 1
fi

echo "config.json loaded successfully from /app/data/config.json"
