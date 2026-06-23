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

# Release signing: if a keystore is provided, force a real release signingConfig
# via a Gradle init script (the Expo template otherwise signs `release` with the
# debug key, which the Play Store rejects). No keystore → debug-signed.
GRADLE_ARGS=(--no-daemon)
if [[ -n "${ANDROID_KEYSTORE_FILE:-}" && -f "${ANDROID_KEYSTORE_FILE}" ]]; then
  : "${ANDROID_KEYSTORE_PASSWORD:?set ANDROID_KEYSTORE_PASSWORD}"
  : "${ANDROID_KEY_ALIAS:?set ANDROID_KEY_ALIAS}"
  echo "▶ Release-signing with ${ANDROID_KEYSTORE_FILE}"
  GRADLE_ARGS+=(--init-script "$APP/scripts/release-signing.init.gradle")
else
  echo "⚠ No ANDROID_KEYSTORE_FILE set — output will be DEBUG-signed."
  echo "  Good for sideloading/testing; the Play Store will REJECT it."
fi

echo "▶ Building APK + AAB…"
./gradlew "${GRADLE_ARGS[@]}" assembleRelease bundleRelease

mkdir -p "$OUT"
cp -v app/build/outputs/apk/release/*.apk "$OUT"/ 2>/dev/null || echo "  (no APK produced)"
cp -v app/build/outputs/bundle/release/*.aab "$OUT"/ 2>/dev/null || echo "  (no AAB produced)"

# Sanity-check what actually signed the bundle — the debug key's cert is
# CN=Android Debug, which is exactly what the Store complains about.
aab="$(ls "$OUT"/*.aab 2>/dev/null | head -1 || true)"
if [[ -n "$aab" ]]; then
  cert="$(keytool -printcert -jarfile "$aab" 2>/dev/null || true)"
  if echo "$cert" | grep -qi 'Android Debug'; then
    echo "❌ The AAB is DEBUG-signed (CN=Android Debug) — the Play Store will reject it."
    echo "   Re-run with ANDROID_KEYSTORE_FILE / _PASSWORD / ANDROID_KEY_ALIAS set."
  else
    echo "▶ AAB signing certificate:"
    echo "$cert" | grep -iE 'Owner:|Propriétaire|Valid|Vald|valable' | head -2
  fi
fi

echo "✅ Done — artifacts are in ./build-output/"

