#!/usr/bin/env node
// Thin wrapper around the shared RTL guard (@workspace/scripts/rtl-guard.mjs),
// the same guard the web/mockup artifacts run. This artifact only supplies its
// scan roots and the React-Native-specific options so the detection logic can
// never drift apart — mirroring scripts/check-i18n.mjs.
//
// Two mobile-specific choices:
//   * scans: ["styleSheet", "mobileInlineStyles"] — the React Native passes.
//     `styleSheet` scans StyleSheet.create({...}) objects; `mobileInlineStyles`
//     scans inline `style={{ }}` props (where this app does almost all of its
//     layout) for STATIC physical direction props, while allowing the dir-aware
//     values/computed-keys it legitimately uses to mirror. The web Tailwind /
//     lucide-icon scan has nothing to scan (RN has no className), the web
//     `inlineStyles` pass is too strict for RN (it flags physical prop names
//     even when their value is computed from `dir`), and the bidi-scramble scan
//     is literal-isolate based so it cannot see the app's ltrIsolate() helper
//     and would false-positive on correct countdown code. RTL mirroring lives in
//     dir-aware styles (flexDirection: rowDirection(dir), textAlign(dir), …) per
//     lib/i18n.tsx.
//   * ignore: ErrorFallback.tsx — the crash screen renders ABOVE the
//     I18nProvider (see app/_layout.tsx), so it cannot read `dir` and must keep
//     its static StyleSheet (it stays context-free English by the same rule the
//     i18n guard applies).
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runRtlGuard } from "@workspace/scripts/rtl-guard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// The Expo app has no `src/` root; its source lives in these top-level dirs.
const SRC = ["app", "components", "hooks", "lib", "constants"].map((d) =>
  join(ROOT, d),
);

runRtlGuard({
  rootDir: ROOT,
  srcDir: SRC,
  scans: ["styleSheet", "mobileInlineStyles"],
  ignore: ["components/ErrorFallback.tsx"],
});
