#!/usr/bin/env node
// Thin wrapper around the shared i18n guard (@workspace/scripts/i18n-guard.mjs),
// the same guard the web artifact runs. This artifact only supplies its scan
// roots and dictionary location so the detection logic can never drift apart.
//
// Two mobile-specific options are passed:
//   * scanDevSinks: false — React Native has no web-style user-facing sinks
//     (toast/sonner, window.confirm/alert, custom error overlays). Its only
//     user-facing copy lives in JSX text and UI attributes. console.* logging
//     and internally-caught thrown Errors are developer-facing, never rendered
//     to users, so scanning them would only produce noise.
//   * ignore: ErrorFallback.tsx — the crash screen renders ABOVE the
//     I18nProvider (see app/_layout.tsx), so it cannot call useI18n() and must
//     stay context-free English by design.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runI18nGuard } from "@workspace/scripts/i18n-guard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// The Expo app has no `src/` root; its source lives in these top-level dirs.
const SRC = ["app", "components", "hooks", "lib", "constants"].map((d) =>
  join(ROOT, d),
);

runI18nGuard({
  rootDir: ROOT,
  srcDir: SRC,
  i18nFile: join(ROOT, "lib", "translations.ts"),
  scanDevSinks: false,
  ignore: ["components/ErrorFallback.tsx"],
});
