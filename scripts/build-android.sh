#!/usr/bin/env bash
# Build TeleForge into an APK + AAB inside Docker — no EAS, no host Android SDK.
# Only requirement on the host: Docker (give it ~8 GB RAM for a RN build).
#
# Usage:
#   scripts/build-android.sh                      # debug-signed (testing)
#
#   # release-signed for the Play Store:
#   ANDROID_KEYSTORE_FILE=credentials/release.jks \
#   ANDROID_KEYSTORE_PASSWORD=... \
#   ANDROID_KEY_ALIAS=upload \
#   ANDROID_KEY_PASSWORD=... \
#     scripts/build-android.sh
#
# On Windows run it from Git Bash or WSL (Docker Desktop required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE=teleforge-android-builder
OUT="$ROOT/build-output"

command -v docker >/dev/null || { echo "Docker is required but not found on PATH."; exit 1; }

echo "▶ Building the builder image ($IMAGE)…"
docker build -f "$ROOT/docker/android.Dockerfile" -t "$IMAGE" "$ROOT/docker"

mkdir -p "$OUT"

# Mount the keystore (if any) read-only and forward its credentials.
KEYSTORE_ARGS=()
if [[ -n "${ANDROID_KEYSTORE_FILE:-}" ]]; then
  [[ -f "$ANDROID_KEYSTORE_FILE" ]] || { echo "Keystore not found: $ANDROID_KEYSTORE_FILE"; exit 1; }
  host_ks="$(cd "$(dirname "$ANDROID_KEYSTORE_FILE")" && pwd)/$(basename "$ANDROID_KEYSTORE_FILE")"
  KEYSTORE_ARGS=(
    -v "$host_ks:/keystore.jks:ro"
    -e ANDROID_KEYSTORE_FILE=/keystore.jks
    -e ANDROID_KEYSTORE_PASSWORD
    -e ANDROID_KEY_ALIAS
    -e ANDROID_KEY_PASSWORD
  )
fi

# Named volumes persist the Gradle and bun caches between runs (fast rebuilds).
docker run --rm \
  -v "$ROOT:/src:ro" \
  -v "$OUT:/out" \
  -v teleforge-gradle-cache:/root/.gradle \
  -v teleforge-bun-cache:/root/.bun/install/cache \
  "${KEYSTORE_ARGS[@]}" \
  "$IMAGE" \
  bash /src/scripts/docker-entrypoint.sh

echo
echo "✅ Artifacts in build-output/:"
ls -lh "$OUT"
