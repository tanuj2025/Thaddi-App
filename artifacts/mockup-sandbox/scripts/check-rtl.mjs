#!/usr/bin/env node
// Thin wrapper around the shared RTL guard (@workspace/scripts/rtl-guard.mjs).
// This artifact only supplies its scan root; all detection logic is shared so
// the two artifact copies can never drift apart.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runRtlGuard } from "@workspace/scripts/rtl-guard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// The design preview tool scans its entire src tree so backwards directional
// icons are caught in every component, not just the vendored ui/ primitives.
runRtlGuard({ rootDir: ROOT, srcDir: join(ROOT, "src") });
