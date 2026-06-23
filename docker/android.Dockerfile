# Android build environment for TeleForge (Expo SDK 56 / RN 0.85).
#
# OS-agnostic: everything needed to turn the managed Expo app into a signed
# APK + AAB lives in this image, so the only thing the host needs is Docker.
# The build steps themselves live in scripts/docker-entrypoint.sh (mounted at
# run time), so tweaking the build doesn't require rebuilding this image.

FROM node:22-bookworm

# --- Pinned tool versions (override with --build-arg) ---
# RN 0.85 needs compileSdk 36, build-tools 36, NDK 27.1.x, JDK 17.
ARG ANDROID_CMDLINE_TOOLS_VERSION=11076708
ARG ANDROID_PLATFORM=android-36
ARG ANDROID_BUILD_TOOLS=36.0.0
ARG ANDROID_NDK=27.1.12297006
ARG ANDROID_CMAKE=3.22.1
ARG BUN_VERSION=1.3.11

ENV DEBIAN_FRONTEND=noninteractive \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    ANDROID_HOME=/opt/android-sdk

# JDK 17 + build prerequisites.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-17-jdk-headless unzip wget git ca-certificates rsync \
    && rm -rf /var/lib/apt/lists/*

# JAVA_HOME, resolved arch-agnostically (amd64 / arm64 paths differ).
RUN ln -sf "$(dirname "$(dirname "$(readlink -f "$(which javac)")")")" /opt/java
ENV JAVA_HOME=/opt/java
ENV PATH=${PATH}:${JAVA_HOME}/bin

# Android command-line tools.
RUN mkdir -p ${ANDROID_SDK_ROOT}/cmdline-tools \
    && wget -q "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_VERSION}_latest.zip" -O /tmp/cmdtools.zip \
    && unzip -q /tmp/cmdtools.zip -d ${ANDROID_SDK_ROOT}/cmdline-tools \
    && mv ${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools ${ANDROID_SDK_ROOT}/cmdline-tools/latest \
    && rm /tmp/cmdtools.zip
ENV PATH=${PATH}:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools

# Accept licenses and install the SDK packages (35 kept alongside 36 as a
# fallback for modules that haven't bumped their compileSdk yet).
RUN yes | sdkmanager --licenses >/dev/null \
    && sdkmanager --install \
       "platform-tools" \
       "platforms;${ANDROID_PLATFORM}" \
       "platforms;android-35" \
       "build-tools;${ANDROID_BUILD_TOOLS}" \
       "build-tools;35.0.0" \
       "ndk;${ANDROID_NDK}" \
       "cmake;${ANDROID_CMAKE}" >/dev/null

# Project package manager.
RUN npm install -g "bun@${BUN_VERSION}"

WORKDIR /app
