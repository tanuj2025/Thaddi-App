# Android release network smoke test

This is a release-mode device test for offline recovery. It uses ADB to
install the APK and toggle Wi‑Fi/mobile data, and Maestro to drive the UI.
The radios are restored by the wrapper even when an assertion fails.

## Prerequisites

- A booted Android emulator or a USB-connected device with USB debugging.
- `adb` and [Maestro](https://maestro.mobile.dev/) on `PATH`.
- A release APK built from this workspace.
- A seed flow that signs in with CI/local test credentials and visits the
  normal data screens while online. Do not commit credentials.

The seed flow is deliberately supplied by the caller because authentication
and test data are environment-specific. It must leave the app with usable
query-cache data; the smoke test then keeps that app data for the cached
offline phase.

## Local run

Build a release APK using the existing Android script:

```sh
pnpm --filter @workspace/thaddi-mobile run android -- --variant release
```

Run the five phases:

```sh
ANDROID_APK=artifacts/thaddi-mobile/android/app/build/outputs/apk/release/app-release.apk \
THADDI_SMOKE_SEED_FLOW=path/to/local-seed.yaml \
pnpm --filter @workspace/thaddi-mobile run test:android:release
```

The runner:

1. Installs the release APK and runs the online seed flow.
2. Disables networking and verifies Arabic cached continuation, banner, and
   navigation state.
3. Clears app data, stays offline, and verifies the Arabic no-cache recovery
   screen with Retry and Continue.
4. Switches the fresh app to English, disables networking, and verifies the
   English recovery screen and both actions.
5. Restores networking and verifies Retry returns to normal loading.

## CI contract

Install Android SDK platform tools, boot the configured emulator, install
Maestro, build the release APK, and set `THADDI_SMOKE_SEED_FLOW` to a
workspace-local flow created by the CI job. Store credentials used by that
flow in the CI secret store. The command and assertions are otherwise the
same as the local command above.

The checked-in flows under `.maestro/` contain the network-transition
assertions. `android-release-set-english.yaml` runs before the English
offline phase because clearing app data also clears the persisted language.