#!/usr/bin/env node
/**
 * Release validation: check that deep-link association files have been
 * configured with real credentials before shipping a build.
 *
 * Run:  node scripts/check-deeplinks.mjs
 * CI:   fails with exit code 1 when placeholders are still present.
 *
 * Required files (hosted at https://thaddi.app/.well-known/):
 *  - apple-app-site-association  — iOS Universal Links
 *    placeholder: REPLACE_WITH_APPLE_TEAM_ID
 *    real value : 10-char Apple Team ID (e.g. AB12CD34EF) from
 *                 https://developer.apple.com/account → Membership → Team ID
 *
 *  - assetlinks.json             — Android App Links
 *    placeholder: REPLACE_WITH_SHA256_CERT_FINGERPRINT
 *    real value : SHA-256 fingerprint of the release keystore, obtainable via:
 *                 eas credentials   (Expo managed)
 *                 keytool -list -v -keystore release.keystore  (self-managed)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wellKnown = join(__dirname, "../artifacts/thaddi/public/.well-known");

let errors = 0;

function check(filename, ...placeholders) {
  const path = join(wellKnown, filename);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    console.error(`✗ Missing file: ${filename}`);
    errors++;
    return;
  }

  for (const placeholder of placeholders) {
    if (text.includes(placeholder)) {
      console.error(
        `✗ ${filename}: still contains placeholder "${placeholder}" — replace it with the real value before shipping`,
      );
      errors++;
    }
  }
}

check("apple-app-site-association", "REPLACE_WITH_APPLE_TEAM_ID");
check("assetlinks.json", "REPLACE_WITH_SHA256_CERT_FINGERPRINT");

if (errors > 0) {
  console.error(
    `\nDeep-link validation failed (${errors} issue${errors === 1 ? "" : "s"}). ` +
      "See comments in scripts/check-deeplinks.mjs for how to obtain the real values.",
  );
  process.exit(1);
} else {
  console.log(
    "✔ Deep-link association files look real (no placeholders found).",
  );
}
