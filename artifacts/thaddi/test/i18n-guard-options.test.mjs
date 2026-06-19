import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanHardcodedEnglish } from "@workspace/scripts/i18n-guard.mjs";

// These tests lock in the two options the mobile (React Native) wrapper relies
// on. The shared guard defaults to the web's full behaviour; mobile opts out of
// developer-facing sinks and ignores its context-free crash screen. A future
// edit that silently changes either default would either start flooding the
// mobile guard with noise (dev sinks) or stop catching real JSX text.

function withFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "i18n-guard-opts-"));
  for (const [name, contents] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents, "utf8");
  }
  return dir;
}

function scan(dir, options) {
  const errors = [];
  scanHardcodedEnglish(
    { rootDir: dir, srcDir: dir, i18nFile: join(dir, "__dict__.ts"), ...options },
    errors,
  );
  return errors;
}

test("scanDevSinks:true (default) flags console.* and thrown Errors", () => {
  const dir = withFixture({
    "a.tsx": [
      "function f() {",
      "  console.warn('Something went wrong here');",
      "  throw new Error('Payment processing failed badly');",
      "}",
    ].join("\n"),
  });
  try {
    const errors = scan(dir, {});
    const joined = errors.join("\n");
    assert.match(joined, /Something went wrong here/);
    assert.match(joined, /Payment processing failed badly/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanDevSinks:false skips console.* and thrown Errors but still flags JSX text", () => {
  const dir = withFixture({
    "a.tsx": [
      "export function C() {",
      "  console.warn('Something went wrong here');",
      "  throw new Error('Payment processing failed badly');",
      "  return <Text>Please reload the app</Text>;",
      "}",
    ].join("\n"),
  });
  try {
    const errors = scan(dir, { scanDevSinks: false });
    const joined = errors.join("\n");
    assert.doesNotMatch(joined, /Something went wrong here/);
    assert.doesNotMatch(joined, /Payment processing failed badly/);
    // User-facing JSX text is still caught.
    assert.match(joined, /Please reload the app/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignore skips matching files entirely", () => {
  const dir = withFixture({
    "ErrorFallback.tsx": "export const X = () => <Text>Something went wrong</Text>;",
    "Other.tsx": "export const Y = () => <Text>Real untranslated copy</Text>;",
  });
  try {
    const errors = scan(dir, { ignore: ["ErrorFallback.tsx"] });
    const joined = errors.join("\n");
    assert.doesNotMatch(joined, /Something went wrong/);
    // Non-ignored files are still scanned.
    assert.match(joined, /Real untranslated copy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
