---
name: THADDI mobile standalone EAS export
description: How to produce a self-contained Expo/EAS iOS OR Android build ZIP from the monorepo mobile app, and the lockfile/sandbox gotchas that break it.
---

# Standalone EAS export for thaddi-mobile

**Goal:** a ZIP the user can `npm install` + `eas build` on their own machine (Android needs NO Mac), with NO pnpm-monorepo (`workspace:*` / `catalog:`) leakage. Build it in a staging dir (e.g. `/tmp/android-build/thaddi-mobile/`), never add `eas.json` to the live `artifacts/thaddi-mobile` (that breaks Replit Expo Launch — see thaddi-mobile.md).

**Android-specific deltas (vs the iOS recipe below):**
- `app.json` MUST add `android.package` (`app.thaddi`) + `android.versionCode` — an external EAS Android build fails without a package id.
- `eas.json`: `preview` profile = `distribution:"internal"` + `android.buildType:"apk"` → directly-installable APK with a download link/QR. `production` profile = `android.buildType:"app-bundle"` → `.aab` for Play Console. Set `cli.appVersionSource:"local"` to avoid remote version prompts.
- Ship a `.npmrc` containing ONLY `legacy-peer-deps=true` (NO registry line) so the user's `npm ci`/EAS install doesn't ERESOLVE-fail on react-19 peer ranges. Generate the lockfile WITH this `.npmrc` present so it stays consistent.
- **EAS rejects EMPTY-string env values** in `eas.json` (`eas init`/`eas build` fail: "...is not allowed to be empty"). So you can't ship `"EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY": ""` as a "leave it blank" placeholder — either OMIT the key entirely (app reads `process.env.X` as undefined, same graceful path) or give it the real value. The real RevenueCat Android key is a PUBLIC `goog_` client key (safe to embed); read its exact value via `viewEnvVars` (it's a shared CONFIG, not a secret) rather than transcribing from a screenshot (I-vs-J/O-vs-0 ambiguity).
- **Android Gradle `mergeReleaseJavaResource` FAILS on duplicate `META-INF/versions/9/OSGI-INF/MANIFEST.MF`** (shipped by BOTH `okhttp3:logging-interceptor` and `org.jspecify:jspecify`, pulled transitively). EAS surfaces it as the generic "Gradle build failed with unknown error" — the real cause is at the bottom of the "Run gradlew" phase. Fix in `app.json` `expo-build-properties` → add `android.packagingOptions.exclude: ["META-INF/versions/9/OSGI-INF/MANIFEST.MF","META-INF/versions/9/OSGI-INF/**"]` (schema confirmed in plugin `pluginConfig.d.ts`; OSGi metadata is unused on Android so excluding is safe). Include this in the Android export ZIP's `app.json` from the start. NOTE EAS builds from the GIT-COMMITTED tree → after editing the user must `git add -A && git commit` BEFORE re-running `eas build` or the fix is ignored.
- Env values: secret VALUES can't be read in-platform (only existence). The Clerk publishable key is a *public* `pk_live_…` but still can't be auto-baked → put a placeholder in `eas.json` `env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` + README instructions; `EXPO_PUBLIC_DOMAIN="thaddi.app"` is known-correct and pre-fillable; RevenueCat Android key optional (IAP can't work on a sideloaded APK anyway; lib degrades gracefully when empty).
- Cross-check before zipping: regex-extract every external import in `app/components/lib/hooks/constants/vendor` and assert each resolves to a `package.json` dep (catches a wrongly-dropped dep). Dropping test deps (jest/jest-expo/@testing-library/react-test-renderer) + `@expo/cli`/`@expo/ngrok`/`babel-plugin-react-compiler` is safe; keep polyfills (`@stardazed/streams-text-encoding`, `@ungap/structured-clone`).

**Transformations required:**
- Vendor the workspace API client (`lib/api-client-react/src` → `vendor/api-client-react/src`, 4 files; its only external deps are `@tanstack/react-query` + `react`). Resolve it via BOTH tsconfig `paths` AND a metro `resolver.resolveRequest` alias chained to Expo's default resolver. Alias-only is fine — do NOT add it to `package.json` deps (no native modules, no autolinking). `file:vendor/...` is optional, not needed.
- `package.json`: replace every `catalog:` with the concrete version (read from `pnpm-workspace.yaml`), drop the workspace dep, drop `@expo/cli`/`@expo/ngrok`/`babel-plugin-react-compiler`, move runtime deps into `dependencies`, add EAS scripts.
- `app.json`: change expo-router `origin` off `replit.com` → prod host; keep the `expo-build-properties` iOS `extraPods` modular_headers block (Clerk auto-links Google pods — see thaddi-mobile.md). `eas init` (writes `extra.eas.projectId`+`owner`) is a Mac-side manual step — do NOT hardcode.

**Lockfile portability — TWO gotchas, both silently break `npm ci`/EAS:**
1. A lockfile generated with `--prefer-offline` leaves empty `{}` stub nodes for packages not in the warm cache (here: the `@radix-ui/*` tree). Empty version → `TypeError: Invalid Version` in arborist `canDedupe` during `npm ci`. Fix: regenerate FULLY ONLINE (`npm install --package-lock-only`, no prefer-offline) → 0 stubs.
2. Replit's lockfile records `resolved` tarball URLs as `http://package-firewall.replit.local/npm/...` (unreachable off-Replit). Rewrite all to `https://registry.npmjs.org/` (identical path after `/npm/`). `integrity` is content-hash based, so it stays valid. Verify 0 `package-firewall.replit.local` remain. Also confirm no `.npmrc` (firewall registry) is in the staged dir.
**Why:** EAS Build runs `npm ci`, which is strict about both the stub crash and the unreachable hosts; `npm install --package-lock-only` alone (the obvious "validate deps" step) catches neither.

**expo-router legitimately depends on `vaul` → `@radix-ui/react-dialog/tabs/slot`** (its web drawer/tabs). Seeing web Radix packages in an RN lockfile is NOT contamination — don't try to remove them.

**Sandbox constraints (Replit Linux container):**
- A full RN/Expo `node_modules` extraction OOM-kills (cgroup) alongside the running dev workflows — so `npx expo-doctor` / `expo export` can't be run here; document them as Mac-side steps. The lockfile (`--package-lock-only`, rc=0) + the fact the same versions run live is the in-Replit validation.
- **Background jobs spawned inside a `bash` tool call are KILLED when the call returns** (even with `nohup ... &`): you get a zero-byte log and no output. RUN `npm install --package-lock-only` IN THE FOREGROUND. It usually exceeds the ~120s bash cap on a cold metadata cache, BUT npm warms `~/.npm/_cacache` as it goes, so a timed-out first run + a rerun finishes fast (saw `up to date in 20s`, lockfile written). Confirm progress by watching cacache file count grow, not by pgrep.
- `pgrep -f "<pattern>"` / `pkill -f` SELF-MATCH the issuing shell (its own command line contains the literal pattern), giving phantom "RUNNING" or exit 137. Use a bracket pattern (`'in[s]tall'`) or check by an explicit PID / the actual artifact (lockfile, cacache growth).
- `zip` is not installed — build the archive with Python `zipfile`. Exclude `node_modules`/`.expo`/`dist`/`.tsbuildinfo`/`*.log`/`.git`, INCLUDE `package-lock.json`. Write the ZIP under `/home/runner/workspace/...` so `present_asset` can serve it.

**Known Apple gap:** auth is Google OAuth via Clerk with NO native Sign in with Apple → App Review Guideline 4.8 risk; flag it, don't silently ship.
