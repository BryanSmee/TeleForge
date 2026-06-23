#!/usr/bin/env bash
# Runs INSIDE the build container. Turns the mounted source (/src, read-only)
# into a release APK + AAB in /out. Kept separate from the image so the build
# recipe can change without a rebuild.
set -euo pipefail

SRC=/src
APP=/app
OUT=/out

echo "▶ Syncing source into the container…"
# Copy the source out of the read-only mount, skipping host artifacts (the
# host's node_modules is the wrong arch; android/ios are regenerated).
rsync -a --delete \
  --exclude node_modules \
  --exclude /android \
  --exclude /ios \
  --exclude .git \
  --exclude build-output \
  "$SRC"/ "$APP"/

cd "$APP"

echo "▶ Installing dependencies (bun)…"
bun install --frozen-lockfile

echo "▶ Generating the native Android project (expo prebuild)…"
bunx expo prebuild --platform android --clean --no-install

cd "$APP/android"

# Release signing: if a keystore is provided, sign via Gradle's injected
# signing properties (no need to edit the generated build.gradle). Otherwise
# the artifacts get the debug key — fine for sideloading, NOT for the Store.
SIGNING_ARGS=()
if [[ -n "${ANDROID_KEYSTORE_FILE:-}" && -f "${ANDROID_KEYSTORE_FILE}" ]]; then
  echo "▶ Release-signing with ${ANDROID_KEYSTORE_FILE}"
  SIGNING_ARGS=(
    "-Pandroid.injected.signing.store.file=${ANDROID_KEYSTORE_FILE}"
    "-Pandroid.injected.signing.store.password=${ANDROID_KEYSTORE_PASSWORD:?set ANDROID_KEYSTORE_PASSWORD}"
    "-Pandroid.injected.signing.key.alias=${ANDROID_KEY_ALIAS:?set ANDROID_KEY_ALIAS}"
    "-Pandroid.injected.signing.key.password=${ANDROID_KEY_PASSWORD:-${ANDROID_KEYSTORE_PASSWORD}}"
  )
else
  echo "⚠ No ANDROID_KEYSTORE_FILE set — output will be DEBUG-signed."
  echo "  Good for sideloading/testing; the Play Store needs a release keystore."
fi

echo "▶ Building APK + AAB…"
./gradlew --no-daemon assembleRelease bundleRelease "${SIGNING_ARGS[@]}"

mkdir -p "$OUT"
cp -v app/build/outputs/apk/release/*.apk "$OUT"/ 2>/dev/null || echo "  (no APK produced)"
cp -v app/build/outputs/bundle/release/*.aab "$OUT"/ 2>/dev/null || echo "  (no AAB produced)"

echo "✅ Done — artifacts are in ./build-output/"
