# TeleForge: bun, pinned like CI (.github/workflows/ci.yml) and docker/android.Dockerfile.
ARG DECKHAND_BASE=deckhand-sandbox
FROM $DECKHAND_BASE
USER root
ARG BUN_VERSION=1.3.11
RUN npm install -g "bun@${BUN_VERSION}" && npm cache clean --force
USER node
