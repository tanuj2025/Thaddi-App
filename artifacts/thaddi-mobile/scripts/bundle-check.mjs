#!/usr/bin/env node
// Bundle smoke test — verifies that Metro can compile iOS and Android bundles
// without errors after every Babel config change.
//
// Runs `expo export --platform ios` and `expo export --platform android` in
// sequence.  Each invocation exercises the full Metro / Babel transform pipeline
// (including babel.config.js and any registered plugins such as
// expoRouterBabelPlugin) so a broken config causes a non-zero exit and this
// check fails visibly.
//
// EXPO_PUBLIC_* variables are inlined as string literals during bundling; they
// do not need to be real values for the bundle to compile, so we supply safe
// placeholders when the real secrets are absent.  The check never starts a
// server or makes network requests.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function log(msg) {
  process.stdout.write(`[bundle-check] ${msg}\n`);
}

function fatal(msg) {
  process.stderr.write(`[bundle-check] ERROR: ${msg}\n`);
  process.exit(1);
}

function findWorkspaceRoot(startDir) {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Could not find workspace root (no pnpm-workspace.yaml)");
}

// ------------------------------------------------------------------
// Bundle one platform
// ------------------------------------------------------------------

function bundlePlatform(platform, outputDir) {
  log(`Bundling ${platform}…`);

  const env = {
    ...process.env,
    // Required for monorepo Metro workspace resolution
    EXPO_USE_METRO_WORKSPACE_ROOT: "1",
    // Placeholders so Metro can inline EXPO_PUBLIC_* values without failing.
    // Real secrets are not needed to verify the Babel transform pipeline.
    EXPO_PUBLIC_DOMAIN:
      process.env.EXPO_PUBLIC_DOMAIN ||
      process.env.REPLIT_DEV_DOMAIN ||
      "localhost",
    EXPO_PUBLIC_API_URL:
      process.env.EXPO_PUBLIC_API_URL ||
      "https://localhost",
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
      process.env.CLERK_PUBLISHABLE_KEY ||
      "pk_test_bundle_check_placeholder",
    EXPO_PUBLIC_REPL_ID: process.env.EXPO_PUBLIC_REPL_ID || process.env.REPL_ID || "bundle-check",
    EXPO_PUBLIC_REVENUECAT_TEST_API_KEY:
      process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY ||
      "test_bundle_check_placeholder",
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY:
      process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ||
      "appl_bundle_check_placeholder",
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY:
      process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ||
      "goog_bundle_check_placeholder",
  };

  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "expo",
      "export",
      "--platform",
      platform,
      "--no-minify",    // faster; we only care that Babel succeeds, not bundle size
      "--no-bytecode",  // skip Hermes compile step; saves ~30 s per platform
      "--source-maps",  // emit sourcemaps so we can assert a single React copy
      "--output-dir",
      outputDir,
      "--clear",        // always use a fresh Metro cache to catch stale-cache bugs
    ],
    {
      cwd: PROJECT_ROOT,
      env,
      stdio: "inherit",  // stream Metro output so failures are fully visible
      shell: false,
    },
  );

  if (result.error) {
    fatal(`Failed to spawn expo export for ${platform}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fatal(
      `expo export --platform ${platform} exited with code ${result.status}. ` +
        "A Babel config error or missing plugin may be the cause. " +
        "Check the Metro output above for the first transform error.",
    );
  }

  log(`${platform} bundle OK`);

  assertSingleCopy(platform, outputDir);
}

// ------------------------------------------------------------------
// Duplicate-React detection
// ------------------------------------------------------------------
//
// The pnpm workspace can end up with React installed both at the workspace
// root (physically hoisted) and inside this app's node_modules (pnpm store
// symlink).  With EXPO_USE_METRO_WORKSPACE_ROOT=1 Metro can bundle BOTH,
// which crashes the app at launch ("Invalid hook call … more than one copy
// of React").  metro.config.js pins these packages to a single copy; this
// check inspects the exported sourcemap and fails if more than one distinct
// package directory made it into the bundle.

const SINGLETON_PACKAGES = ["react", "react-dom", "scheduler", "react-native"];

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) collectFiles(p, out);
    else out.push(p);
  }
  return out;
}

function assertSingleCopy(platform, outputDir) {
  const maps = collectFiles(outputDir).filter((f) => f.endsWith(".map"));
  if (maps.length === 0) {
    fatal(`No sourcemaps found in ${outputDir}; cannot verify React dedupe.`);
  }

  const dirsByPkg = new Map(SINGLETON_PACKAGES.map((p) => [p, new Set()]));

  for (const mapFile of maps) {
    let sources;
    try {
      sources = JSON.parse(readFileSync(mapFile, "utf8")).sources ?? [];
    } catch (err) {
      fatal(`Could not parse sourcemap ${mapFile}: ${err.message}`);
    }
    for (const src of sources) {
      for (const pkg of SINGLETON_PACKAGES) {
        const marker = `node_modules/${pkg}/`;
        const idx = src.indexOf(marker);
        if (idx !== -1) {
          // Package dir prefix uniquely identifies the physical copy.
          dirsByPkg.get(pkg).add(src.slice(0, idx + marker.length));
        }
      }
    }
  }

  // Sanity: react and react-native must always be present in the bundle.
  // Zero matches would mean this detection is broken (e.g. sourcemap format
  // changed), which must fail loudly rather than silently pass.
  for (const pkg of ["react", "react-native"]) {
    if (dirsByPkg.get(pkg).size === 0) {
      fatal(
        `${platform}: no ${pkg} sources found in sourcemap — duplicate detection is broken.`,
      );
    }
  }

  let dupes = 0;
  for (const [pkg, dirs] of dirsByPkg) {
    if (dirs.size > 1) {
      dupes++;
      process.stderr.write(
        `[bundle-check] DUPLICATE ${pkg} in ${platform} bundle (${dirs.size} copies):\n` +
          [...dirs].map((d) => `  - ${d}\n`).join(""),
      );
    }
  }
  if (dupes > 0) {
    fatal(
      `${platform} bundle contains multiple copies of ${dupes} singleton package(s). ` +
        "Check the pinned-package list in metro.config.js.",
    );
  }
  log(`${platform}: single React copy verified (no duplicate singleton packages).`);
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
  // Sanity-check that we can resolve the workspace root (same guard build.js uses)
  findWorkspaceRoot(PROJECT_ROOT);

  const tmpBase = mkdtempSync(join(tmpdir(), "thaddi-bundle-check-"));
  log(`Output dir: ${tmpBase}`);

  let failed = false;
  try {
    // Sequential: Metro cannot process two platforms simultaneously without risk
    // of stalling (same constraint as build.js).
    bundlePlatform("ios", join(tmpBase, "ios"));
    bundlePlatform("android", join(tmpBase, "android"));
    log("All platforms bundled successfully. Babel config is healthy.");
  } catch (err) {
    failed = true;
    process.stderr.write(`[bundle-check] Unexpected error: ${err.message}\n`);
  } finally {
    // Always clean up the temp output so repeated runs don't fill disk
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  if (failed) process.exit(1);
}

main();
