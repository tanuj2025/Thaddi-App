#!/usr/bin/env node
// Thin wrapper around the shared i18n guard (@workspace/scripts/i18n-guard.mjs).
// This artifact only supplies its scan root and dictionary location; all
// detection logic is shared so any future copy can never drift apart.
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runI18nGuard } from "@workspace/scripts/i18n-guard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");

runI18nGuard({ rootDir: ROOT, srcDir: SRC, i18nFile: join(SRC, "lib", "i18n.tsx") });
