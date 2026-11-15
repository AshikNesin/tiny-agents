#!/usr/bin/env bash
# Renders the launch film's phone stills with the Android app's own Compose code
# (Roborazzi + Robolectric on the JVM; no emulator, no device).
#
#   scripts/demo/launch/tools/android/render.sh
#   DEMO_CLOCK=7:02 scripts/demo/launch/tools/android/render.sh   # another status-bar clock
#
# Needs JDK 21 and an Android SDK with platform 37 (ANDROID_HOME). The test file is copied
# into the app's test source set for the run and removed afterwards, so mobile/ stays clean.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../../.." && pwd)"
android="$repo/mobile/android"
copy="$android/app/src/test/kotlin/groot/mobile/DemoPhoneScreenshotTest.kt"
built="$android/app/build/outputs/roborazzi/demo-launch"
out="$repo/scripts/demo/launch/android"

export ANDROID_HOME="${ANDROID_HOME:-/root/android-sdk}"
[ -d "$ANDROID_HOME/platforms" ] || { echo "Set ANDROID_HOME to an Android SDK with platform 37." >&2; exit 1; }

trap 'rm -f "$copy"' EXIT
cp "$here/DemoPhoneScreenshotTest.kt" "$copy"
rm -rf "$built"

# --rerun: the clock is read from the environment, which Gradle does not track as an input.
(cd "$android" && ./gradlew :app:testDebugUnitTest -Proborazzi.test.record=true \
  --tests 'groot.mobile.DemoPhoneScreenshotTest' --rerun --console=plain)

mkdir -p "$out"
cp "$built"/chat-waiting.png "$built"/chat-approved.png "$built"/chat-waiting-bare.png "$built"/chat-approved-bare.png "$out"/
cp "$built"/positions.json "$out"/chat-positions.json
cp "$built"/positions-bare.json "$out"/chat-positions-bare.json
ls -la "$out"
