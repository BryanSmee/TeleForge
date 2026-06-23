# Building the Android app (local, no EAS)

TeleForge builds to an **APK** (sideload/testing) and an **AAB** (Play Store
upload) entirely inside a Docker container, so the only host requirement is
Docker — no Android SDK, JDK, or EAS account needed. The build is identical on
macOS, Linux, and Windows.

## Prerequisites

- **Docker** (Docker Desktop on macOS/Windows). Give it **~8 GB RAM** — a React
  Native release build is memory-hungry.
- On **Windows**, run the script from **Git Bash** or **WSL**.

## Quick start (debug-signed, for testing)

```bash
scripts/build-android.sh
```

First run takes a while (it builds the image: Android SDK + NDK, ~a few GB, and
downloads Gradle deps). Later runs are much faster — the SDK lives in the image
and the Gradle/bun caches persist in Docker volumes.

Output lands in `build-output/`:
- `app-release.apk` — install on a device with `adb install` or by sideloading.
- `app-release.aab` — the Play Store format.

Without a keystore these are **debug-signed**: fine for installing on your own
device, **not** accepted by the Play Store.

## Release-signed build (for the Play Store)

> The default build is **debug-signed**. If you upload that AAB, the Play
> Console rejects it with *"signed in debug mode / vous devez le signer en mode
> version de sortie"*. You need a release keystore.

1. Create an upload keystore once (uses the JDK in the build image, so you don't
   need one on the host). Keep it and its password safe — losing them means you
   can't update the app:

   ```bash
   scripts/make-keystore.sh           # -> credentials/release.jks, alias "upload"
   ```

2. Build, passing the credentials:

   ```bash
   ANDROID_KEYSTORE_FILE=credentials/release.jks \
   ANDROID_KEYSTORE_PASSWORD=<store password> \
   ANDROID_KEY_ALIAS=upload \
   ANDROID_KEY_PASSWORD=<key password> \
     bun run build:android:local
   ```

   A real `release` signing config is injected via a Gradle init script
   (`scripts/release-signing.init.gradle`), overriding the Expo template's
   default debug signing. The build prints the signing certificate at the end —
   confirm it is **not** `CN=Android Debug`. The resulting `app-release.aab` is
   ready for the Play Console (which re-signs it via Play App Signing).

## How it works

- `docker/android.Dockerfile` — the build environment (JDK 17, Android SDK
  platform 36 + build-tools, NDK 27.1, bun). Tool versions are `--build-arg`s.
- `scripts/docker-entrypoint.sh` — runs inside the container: copies the source
  in, `bun install`, `expo prebuild` (regenerates the native `android/` project,
  which is gitignored), then `gradlew assembleRelease bundleRelease`. Signing is
  injected via Gradle properties, so the generated Gradle files are never edited.
- `scripts/build-android.sh` — host wrapper: builds the image and runs the
  container, mounting the repo read-only and writing artifacts to `build-output/`.

## Versioning

`versionName` comes from `version` in `app.json`. `versionCode` defaults to `1`
unless set under `expo.android.versionCode` — bump it for each Store upload.

## Notes

- The native `android/` directory is regenerated on every build (`--clean`) and
  is gitignored — don't hand-edit it; change `app.json` instead.
- To target a different SDK/NDK, rebuild the image with e.g.
  `docker build --build-arg ANDROID_NDK=27.0.12077973 …`.
