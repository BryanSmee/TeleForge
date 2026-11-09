# TeleForge

Expo (SDK 56) + React Native + TypeScript, Android-first. The package manager is **bun**
(`bun.lock`, CI pins 1.3.11): don't use npm/yarn or create other lockfiles.

## Checks

Setup ran `bun install`. Before pushing, run what CI runs (`.github/workflows/ci.yml`),
all with `CI=1`:

    CI=1 bun run typecheck
    CI=1 bun run lint
    CI=1 bun run test --forceExit

- `expo lint` can hang waiting for input without `CI=1`.
- Jest leaves an open handle after the tests pass; `--forceExit` lets it exit.
- Tests live under `**/__tests__/**/*.test.ts(x)`; add or update them with behaviour changes.
- Bump Expo packages with `bunx expo install <pkg>` (or `--fix`), not by hand.

## Android build (when a change touches native config, dependencies or the build)

The container engine can't see this sandbox's files, so `scripts/build-android.sh`'s bind
mounts don't work here. Copy the source in instead (same image and entrypoint):

```sh
docker build -f docker/android.Dockerfile -t teleforge-android-builder docker
docker rm -f tf-build 2>/dev/null || true
docker create --name tf-build -v teleforge-gradle-cache:/root/.gradle \
  -v teleforge-bun-cache:/root/.bun/install/cache \
  teleforge-android-builder bash /src/scripts/docker-entrypoint.sh
docker cp . tf-build:/src
docker start -a tf-build
docker cp tf-build:/out ./build-output && docker rm tf-build
```

It's slow (SDK image several GB, Gradle downloads): run it only when the change can break
the native build, and say in the pull request whether it passed. Never commit `build-output/`
or keystores; builds here are debug-signed.

## Workflows

`.github/workflows/ci.yml` may be changed when the task needs it. Deckhand refuses a changed
workflow without a read-only top-level `permissions:` (add `permissions: read-all`) or one
that mentions `secrets`.

## Project notes

- Read `docs/architecture.md` before larger changes.
- The backlog is tracked in GitHub issues: new ideas go through the inbox (#28), bugs through
  #29. There is no `docs/TODO.md` any more: don't recreate it, and skip an acceptance
  criterion that asks to update it.
- `packages/core` is pure TypeScript (no React Native imports), aliased as `@teleforge/core`.
- Strings go through i18n: add keys to both English and French under `src/i18n/locales`.
