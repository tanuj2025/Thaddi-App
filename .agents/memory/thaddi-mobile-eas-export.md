---
name: THADDI mobile standalone EAS export
description: How to produce a self-contained Expo/EAS iOS build ZIP from the monorepo mobile app, and the lockfile/sandbox gotchas that break it.
---

# Standalone EAS export for thaddi-mobile

**Goal:** a ZIP the user can `npm install` + `eas build` on their own Mac, with NO pnpm-monorepo (`workspace:*` / `catalog:`) leakage. Build it in a staging dir (e.g. `/tmp/eas-build/thaddi-mobile/`), never add `eas.json` to the live `artifacts/thaddi-mobile` (that breaks Replit Expo Launch — see thaddi-mobile.md).

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
- `pkill`/`pgrep -f "npm install"` SELF-KILLS the issuing shell (its own command line contains the literal `npm install`), giving a phantom exit 137 that looks like OOM. Use a bracket pattern (`'cli\.js in[s]tall'`) or kill by explicit PID.
- `zip` is not installed — build the archive with Python `zipfile`. Exclude `node_modules`/`.expo`/`dist`/`.tsbuildinfo`/`*.log`/`.git`, INCLUDE `package-lock.json`. Write the ZIP under `/home/runner/workspace/...` so `present_asset` can serve it.

**Known Apple gap:** auth is Google OAuth via Clerk with NO native Sign in with Apple → App Review Guideline 4.8 risk; flag it, don't silently ship.
