#!/usr/bin/env node
/**
 * Production health probe for the THADDI API server.
 *
 * Hits the public, READ-ONLY endpoints that gate the landing/onboarding
 * experience and confirms each returns HTTP 200 with a sane shape. It is safe
 * to run against production at any time: it performs no writes, sends no auth,
 * and never mutates state.
 *
 * Usage:
 *   node scripts/health-probe.mjs                  # probes https://thaddi.app/api
 *   node scripts/health-probe.mjs https://thaddi-mvp-build.replit.app/api
 *   HEALTH_BASE_URL=http://127.0.0.1:8080/api node scripts/health-probe.mjs
 *
 * Or via pnpm:  pnpm --filter @workspace/api-server run health:prod
 *
 * Exit code 0 = every probe passed; 1 = at least one probe failed (CI-friendly).
 *
 * NOTE on deployment logs: the platform's generic port-readiness probe hits the
 * service root `/api` (which has no route -> 404 when healthy) and may log a few
 * `healthcheck /api returned status 500` lines in the ~hundreds-of-ms cold-start
 * window before the port settles. That is expected autoscale cold-start noise.
 * The CONFIGURED startup health gate is `/api/healthz` (see artifact.toml), a
 * static handler that returns 200 the instant Express is listening. This probe
 * checks `/api/healthz`, the real readiness signal.
 */

const DEFAULT_BASE = "https://thaddi.app/api";
const base = (process.argv[2] || process.env.HEALTH_BASE_URL || DEFAULT_BASE).replace(
  /\/+$/,
  "",
);
const TIMEOUT_MS = 20_000;

let passed = 0;
const failures = [];

function record(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  \u2713 ${label}`);
  } else {
    const msg = detail ? `${label} \u2014 ${detail}` : label;
    failures.push(msg);
    console.error(`  \u2717 ${msg}`);
  }
}

async function getJson(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base + path, {
      headers: { "User-Agent": "thaddi-health-probe/1.0" },
      signal: ctrl.signal,
    });
    let data;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Each probe: { path, label, ok(data) -> boolean, info?(data) -> string }
 * `ok` is only consulted when the response is HTTP 200.
 */
const PROBES = [
  {
    path: "/healthz",
    label: "healthz (configured startup gate)",
    ok: (d) => d?.status === "ok",
  },
  {
    path: "/platform-stats",
    label: "platform-stats",
    ok: (d) =>
      typeof d?.totalUsers === "number" &&
      typeof d?.totalChallenges === "number" &&
      typeof d?.totalPredictions === "number",
    info: (d) =>
      `users=${d.totalUsers} challenges=${d.totalChallenges} predictions=${d.totalPredictions}`,
  },
  {
    path: "/feature-flags",
    label: "feature-flags",
    ok: (d) => Array.isArray(d) && d.every((f) => typeof f?.key === "string"),
    info: (d) => `${d.length} flags`,
  },
  {
    path: "/plans",
    label: "plans",
    ok: (d) => Array.isArray(d) && d.length > 0 && d.every((p) => typeof p?.code === "string"),
    info: (d) => `${d.length} plans`,
  },
  {
    path: "/teams",
    label: "teams (football catalog present)",
    ok: (d) => Array.isArray(d?.teams) && d.teams.length > 0,
    info: (d) => `${d.teams.length} teams`,
  },
  {
    path: "/schedule",
    label: "schedule (fixtures synced)",
    ok: (d) => typeof d?.scheduleState === "string" && Array.isArray(d?.matches),
    info: (d) => `state=${d.scheduleState} matches=${d.matches.length}`,
  },
  {
    path: "/upcoming-matches",
    label: "upcoming-matches",
    ok: (d) => typeof d?.scheduleState === "string" && Array.isArray(d?.matches),
    info: (d) => `state=${d.scheduleState} matches=${d.matches.length}`,
  },
];

async function main() {
  console.log(`\nTHADDI API health probe -> ${base}\n${"-".repeat(60)}`);
  for (const probe of PROBES) {
    try {
      const { status, data } = await getJson(probe.path);
      if (status !== 200) {
        record(`${probe.label} [GET ${probe.path}]`, false, `HTTP ${status}`);
        continue;
      }
      const shapeOk = probe.ok(data);
      const detail = shapeOk && probe.info ? probe.info(data) : shapeOk ? undefined : "unexpected shape";
      record(`${probe.label} [200]${detail ? ` ${detail}` : ""}`, shapeOk, shapeOk ? undefined : detail);
    } catch (err) {
      record(`${probe.label} [GET ${probe.path}]`, false, err?.message || String(err));
    }
  }

  console.log("-".repeat(60));
  if (failures.length === 0) {
    console.log(`Health probe: ALL ${passed} checks passed against ${base}\n`);
    process.exit(0);
  } else {
    console.error(`Health probe: ${failures.length} FAILED, ${passed} passed against ${base}`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error("");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Health probe crashed:", err);
  process.exit(1);
});
