/**
 * Clerk FAPI proxy resilience tests.
 *
 * Verifies that when the upstream connection to Clerk fails the proxy emits a
 * controlled fallback instead of a bare `500 Internal Server Error`:
 *   - browser navigations (e.g. the OAuth callback) are redirected back to the
 *     sign-in page,
 *   - XHR/fetch callers get a clean 503 JSON body,
 *   - idempotent GETs are retried (with backoff) on pre-connect failures and
 *     still terminate quickly — they never hang on the proxy timeout,
 *   - the one-time POST callback is NEVER retried.
 *
 * The upstream is pointed (via CLERK_FAPI_URL) at a guaranteed-closed local
 * port so every attempt fails fast with ECONNREFUSED — a pre-connect error,
 * which is the only class the proxy retries.
 *
 * Run: tsx --test test/clerkProxy.test.ts
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net, { type AddressInfo } from "node:net";

// Configure the proxy BEFORE importing it — the module reads these at load.
process.env.NODE_ENV = "production";
process.env.CLERK_SECRET_KEY = "sk_test_dummy";
process.env.LOG_LEVEL = "silent";

/** Bind then immediately release a port so connecting to it yields ECONNREFUSED. */
async function getClosedPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

let server: http.Server;
let baseUrl: string;

before(async () => {
  const closedPort = await getClosedPort();
  process.env.CLERK_FAPI_URL = `http://127.0.0.1:${closedPort}`;

  const express = (await import("express")).default;
  const { clerkProxyMiddleware, CLERK_PROXY_PATH } = await import(
    "../src/middlewares/clerkProxyMiddleware"
  );

  const app = express();
  // Mount exactly as app.ts does: before any body parser.
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server?.close();
});

interface Resp {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  elapsedMs: number;
}

function request(opts: {
  method: string;
  path: string;
  headers?: Record<string, string>;
}): Promise<Resp> {
  const url = new URL(baseUrl + opts.path);
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: opts.method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: opts.headers,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            elapsedMs: Date.now() - start,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("XHR GET upstream failure returns a clean 503 (not a bare 500) after retrying", async () => {
  const res = await request({
    method: "GET",
    path: "/api/__clerk/v1/client",
    headers: { accept: "application/json" },
  });

  assert.equal(res.status, 503);
  assert.match(String(res.headers["content-type"]), /application\/json/);
  const json = JSON.parse(res.body);
  assert.equal(json.error, "clerk_upstream_unavailable");
  // Two retries with 100ms + 200ms backoff before giving up.
  assert.ok(
    res.elapsedMs >= 250,
    `expected retry backoff (>=250ms), got ${res.elapsedMs}ms`,
  );
  // ...but it must terminate well under the 30s proxy timeout (i.e. not hang).
  assert.ok(res.elapsedMs < 5000, `proxy appears to hang: ${res.elapsedMs}ms`);
});

test("navigation GET upstream failure redirects to the sign-in page", async () => {
  const res = await request({
    method: "GET",
    path: "/api/__clerk/v1/client",
    headers: { "sec-fetch-mode": "navigate", accept: "text/html" },
  });

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/sign-in?auth_error=connection");
});

test("navigation POST (Apple form_post callback) is NOT retried but still redirects", async () => {
  const res = await request({
    method: "POST",
    path: "/api/__clerk/v1/oauth_callback",
    headers: { "sec-fetch-mode": "navigate" },
  });

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/sign-in?auth_error=connection");
  // No retry backoff for the one-time authorization-code POST.
  assert.ok(
    res.elapsedMs < 200,
    `POST must not be retried, but took ${res.elapsedMs}ms`,
  );
});
