#!/usr/bin/env node
/**
 * Cross-platform (Windows <-> Linux) compatibility guardrail.
 *
 * Catches the classic "works on my Windows machine, breaks on Linux CI/Replit"
 * (and vice versa) failure modes before they reach a build:
 *
 *   1. Import-case mismatches — Windows/macOS filesystems are case-insensitive,
 *      so `import "./Header"` resolves against `header.tsx` locally but fails
 *      on Linux. We verify every relative import matches on-disk casing exactly.
 *   2. CRLF line endings committed into source files (breaks shebangs, diffs,
 *      and some tooling). Enforced alongside .gitattributes.
 *   3. Non-portable package.json scripts — `export VAR=`, bare `VAR=cmd`
 *      prefixes, or `$VAR` expansion that only works in a POSIX shell.
 *
 * Usage: node scripts/xplat-check.mjs   (run from anywhere in the repo)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

// Scripts that are Replit/POSIX-only on purpose (documented in replit.md).
const SCRIPT_ALLOWLIST = new Set([
  "artifacts/thaddi-mobile/package.json#dev", // uses $REPLIT_* env, Replit-only dev server
]);

const SOURCE_EXT = /\.(m?[jt]sx?|c[jt]s|json|css|html|md|ya?ml|sql|svg|sh)$/i;
// Paths whose contents we don't own (vendored skill data, etc.)
const PATH_IGNORE = [".agents/", ".local/", "node_modules/"];

function tracked() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8").split("\0").filter(Boolean);
}

/* ---------- 1. CRLF check ---------- */
{
  const out = execFileSync("git", ["ls-files", "--eol"], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  for (const line of out.split("\n")) {
    if (!line) continue;
    const m = line.match(/^i\/(\S+)\s+w\/\S+\s+attr\/\S*\s+(.+)$/) || line.match(/^i\/(\S+)\s+w\/\S+\s+attr\/\s*(.+)$/);
    if (!m) continue;
    const [, index, file] = m;
    if (!/crlf|mixed/.test(index)) continue;
    if (PATH_IGNORE.some((p) => file.startsWith(p))) continue;
    if (!SOURCE_EXT.test(file)) continue;
    problems.push(`CRLF line endings committed in: ${file} (run: git add --renormalize ${file})`);
  }
}

/* ---------- 2. Import-case check ---------- */
{
  // Cache directory listings for exact-case comparison (works even on
  // case-insensitive filesystems, so Windows devs get the same failure).
  const dirCache = new Map();
  const listDir = (dir) => {
    if (!dirCache.has(dir)) {
      try { dirCache.set(dir, new Set(fs.readdirSync(dir))); }
      catch { dirCache.set(dir, null); }
    }
    return dirCache.get(dir);
  };
  const existsExact = (abs) => {
    const rel = path.relative(repoRoot, abs);
    if (rel.startsWith("..")) return true; // outside repo — skip
    let cur = repoRoot;
    for (const seg of rel.split(path.sep)) {
      const entries = listDir(cur);
      if (!entries) return false;
      if (!entries.has(seg)) return false;
      cur = path.join(cur, seg);
    }
    return true;
  };
  const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts",
    "/index.ts", "/index.tsx", "/index.js"];
  const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g;

  for (const file of tracked()) {
    if (!/\.(m?[jt]sx?|c[jt]s)$/.test(file)) continue;
    if (PATH_IGNORE.some((p) => file.startsWith(p))) continue;
    const abs = path.join(repoRoot, file);
    let src;
    try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
    for (const m of src.matchAll(IMPORT_RE)) {
      let spec = m[1].replace(/\?.*$/, "");
      const base = path.resolve(path.dirname(abs), spec);
      // Find a candidate that exists case-insensitively resolved by Node;
      // then require the exact-case variant to also exist.
      let resolvedAny = false, resolvedExact = false;
      for (const suf of RESOLVE_SUFFIXES) {
        const cand = base + suf;
        let stat = null;
        try { stat = fs.statSync(cand); } catch { /* not there */ }
        if (stat) {
          if (suf === "" && stat.isDirectory()) continue; // need index.* form
          resolvedAny = true;
          if (existsExact(cand)) resolvedExact = true;
          break;
        }
      }
      if (resolvedAny && !resolvedExact) {
        problems.push(`Import case mismatch in ${file}: "${m[1]}" does not match on-disk casing (breaks on Linux).`);
      } else if (!resolvedAny) {
        // Didn't resolve at all (as happens on a case-SENSITIVE fs when only the
        // casing is wrong). Try a case-insensitive walk; if a differently-cased
        // file exists, this import works on Windows but breaks on Linux.
        const relBase = path.relative(repoRoot, base);
        if (!relBase.startsWith("..")) {
          for (const suf of RESOLVE_SUFFIXES) {
            let cur = repoRoot, ok = true;
            for (const seg of (relBase + suf).split(path.sep)) {
              const entries = listDir(cur);
              const hit = entries && [...entries].find((e) => e.toLowerCase() === seg.toLowerCase());
              if (!hit) { ok = false; break; }
              cur = path.join(cur, hit);
            }
            if (ok && fs.existsSync(cur) && !fs.statSync(cur).isDirectory()) {
              problems.push(`Import case mismatch in ${file}: "${m[1]}" only resolves case-insensitively (actual: ${path.relative(repoRoot, cur)}).`);
              break;
            }
          }
        }
        // Otherwise: genuinely unresolvable — left to tsc/bundlers (asset/alias).
      }
    }
  }
}

/* ---------- 3. package.json script portability ---------- */
{
  for (const file of tracked()) {
    if (!file.endsWith("package.json")) continue;
    if (PATH_IGNORE.some((p) => file.startsWith(p))) continue;
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8")); } catch { continue; }
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      if (typeof cmd !== "string") continue;
      if (SCRIPT_ALLOWLIST.has(`${file}#${name}`)) continue;
      if (/^export\s+\w+=/.test(cmd) || /&&\s*export\s+\w+=/.test(cmd)) {
        problems.push(`Non-portable script "${name}" in ${file}: uses "export VAR=" (use cross-env / cross-env-shell).`);
      } else if (
        // bare env prefix at start OR after a command separator (&&, ||, ;)
        [...cmd.matchAll(/(?:^|&&|\|\||;)\s*(\w+=[^\s]*)\s+(\S+)/g)].some(
          (m) => !/^(cross-env|cross-env-shell)$/.test(m[2])
        )
      ) {
        problems.push(`Non-portable script "${name}" in ${file}: bare "VAR=value cmd" env prefix fails on Windows (use cross-env).`);
      } else if (/\$[A-Z_]{2,}/.test(cmd) && !/cross-env-shell/.test(cmd)) {
        problems.push(`Non-portable script "${name}" in ${file}: "$VAR" expansion is POSIX-only (use cross-env-shell or a Node script).`);
      }
    }
  }
}

if (problems.length) {
  console.error(`✖ Cross-platform check failed (${problems.length} issue${problems.length > 1 ? "s" : ""}):\n`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("✓ Cross-platform check passed (line endings, import casing, script portability).");
