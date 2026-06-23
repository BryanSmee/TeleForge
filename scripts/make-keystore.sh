#!/usr/bin/env bash
# Create a release/upload keystore for signing the Play Store build, using the
# JDK inside the build image — so you don't need a JDK on the host.
#
# Usage:
#   scripts/make-keystore.sh                       # -> credentials/release.jks, alias "upload"
#   scripts/make-keystore.sh credentials/my.jks myalias
#
# You'll be prompted for the store/key password and a few certificate fields.
# KEEP THE KEYSTORE AND PASSWORD SAFE: lose them and you can't update the app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE=teleforge-android-builder
OUT_FILE="${1:-credentials/release.jks}"
ALIAS="${2:-upload}"

command -v docker >/dev/null || { echo "Docker is required but not found on PATH."; exit 1; }

dir="$(dirname "$OUT_FILE")"
mkdir -p "$ROOT/$dir"

docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "▶ Building the builder image first…"
  docker build -f "$ROOT/docker/android.Dockerfile" -t "$IMAGE" "$ROOT/docker"
}

echo "▶ Generating keystore $OUT_FILE (alias: $ALIAS)…"
docker run --rm -it \
  -v "$ROOT/$dir:/ks" \
  "$IMAGE" \
  keytool -genkeypair -v \
    -keystore "/ks/$(basename "$OUT_FILE")" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000

echo "✅ Created $OUT_FILE — back it up somewhere safe (it's gitignored)."
