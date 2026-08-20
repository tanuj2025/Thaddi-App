#!/usr/bin/env bash
set -euo pipefail

# Release-mode network transition smoke test.
#
# Prerequisites:
#   - adb, a booted Android emulator (or USB device), and Maestro
#   - a release APK, or an Android project that can produce one
#   - a signed-in seed flow in THADDI_SMOKE_SEED_FLOW. The seed flow
#     must visit the normal data screens while online; its cache is retained for
#     the offline phase.
#
# Example:
#   pnpm --filter @workspace/thaddi-mobile run android -- --variant release
#   ANDROID_APK=artifacts/thaddi-mobile/android/app/build/outputs/apk/release/app-release.apk \
#     pnpm --filter @workspace/thaddi-mobile run test:android:release
#
# CI should provide THADDI_SMOKE_SEED_FLOW with a checked-in flow that reads
# THADDI_SMOKE_EMAIL and THADDI_SMOKE_PASSWORD from the CI secret store.
# Credentials never belong in this script or in a flow committed to the repo.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="${ANDROID_APK:-$ROOT/android/app/build/outputs/apk/release/app-release.apk}"
PACKAGE="app.thaddi"
SEED_FLOW="${THADDI_SMOKE_SEED_FLOW:-}"
MAESTRO="${MAESTRO_BIN:-maestro}"
ADB="${ADB_BIN:-adb}"
LOG_DIR="${ANDROID_SMOKE_LOG_DIR:-$ROOT/.android-release-smoke-logs}"
FLOW_INDEX=0

rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

run_maestro() {
  local flow="$1"
  local name
  FLOW_INDEX=$((FLOW_INDEX + 1))
  name="$(basename "$flow" .yaml)"
  echo "Maestro flow: $flow"
  "$MAESTRO" test "$flow" 2>&1 | tee "$LOG_DIR/maestro-${FLOW_INDEX}-${name}.log"
}

cleanup() {
  # Always restore connectivity, even if an assertion fails.
  "$ADB" shell svc wifi enable >/dev/null 2>&1 || true
  "$ADB" shell svc data enable >/dev/null 2>&1 || true
  "$ADB" logcat -d -v threadtime >"$LOG_DIR/adb-logcat.log" 2>&1 || true
  "$ADB" shell getprop >"$LOG_DIR/adb-getprop.log" 2>&1 || true
  "$ADB" shell dumpsys package "$PACKAGE" >"$LOG_DIR/adb-package.log" 2>&1 || true
}
trap cleanup EXIT

command -v "$ADB" >/dev/null || { echo "android-release-smoke: adb is required" >&2; exit 2; }
command -v "$MAESTRO" >/dev/null || { echo "android-release-smoke: Maestro is required" >&2; exit 2; }
[[ -f "$APK" ]] || {
  echo "android-release-smoke: release APK not found: $APK" >&2
  echo "Build it first with: pnpm --filter @workspace/thaddi-mobile run android -- --variant release" >&2
  exit 2
}

"$ADB" wait-for-device >/dev/null
"$ADB" install -r "$APK" >/dev/null

if [[ -z "$SEED_FLOW" ]]; then
  echo "android-release-smoke: THADDI_SMOKE_SEED_FLOW is required to prove cached navigation." >&2
  echo "Provide an online Maestro flow that signs in with CI credentials and visits Home, Matches, and Profile." >&2
  exit 2
fi
[[ -f "$SEED_FLOW" ]] || { echo "Seed flow not found: $SEED_FLOW" >&2; exit 2; }

echo "1/5 Seeding query cache with online navigation"
"$ADB" shell svc wifi enable >/dev/null
"$ADB" shell svc data enable >/dev/null
run_maestro "$SEED_FLOW"

echo "2/5 Verifying cached navigation while offline (Arabic)"
"$ADB" shell svc wifi disable >/dev/null
"$ADB" shell svc data disable >/dev/null
run_maestro "$ROOT/.maestro/android-release-offline.yaml"

echo "3/5 Verifying no-cache recovery screen (Arabic)"
"$ADB" shell pm clear "$PACKAGE" >/dev/null
"$ADB" shell svc wifi disable >/dev/null
"$ADB" shell svc data disable >/dev/null
run_maestro "$ROOT/.maestro/android-release-offline.yaml"

echo "4/5 Verifying no-cache recovery screen (English)"
# Set the preference while online; the first-launch screen is Arabic by design.
"$ADB" shell svc wifi enable >/dev/null
"$ADB" shell svc data enable >/dev/null
"$ADB" shell pm clear "$PACKAGE" >/dev/null
"$ADB" shell logcat -c >/dev/null 2>&1 || true
run_maestro "$ROOT/.maestro/android-release-set-english.yaml"
EN_FLOW="${THADDI_SMOKE_EN_FLOW:-$ROOT/.maestro/android-release-offline-en.yaml}"
"$ADB" shell svc wifi disable >/dev/null
"$ADB" shell svc data disable >/dev/null
run_maestro "$EN_FLOW"

echo "5/5 Restoring networking and verifying Retry recovery"
"$ADB" shell svc wifi enable >/dev/null
"$ADB" shell svc data enable >/dev/null
run_maestro "$ROOT/.maestro/android-release-online-retry.yaml"

echo "android-release-smoke: PASS"