/**
 * Clerk FAPI proxy — post-connect failure (ECONNRESET) behaviour.
 *
 * The keep-alive agent can occasionally hand the proxy a stale socket that the
 * upstream resets *after* the TCP connection is established. Such errors must
 * NOT be retried (the request body may already have been streamed, and replaying
 * it would hang on the proxy timeout). This test points the proxy at a local
 * server that accepts then immediately destroys every connection — surfacing as
 * ECONNRESET — and asserts the proxy degrades to the graceful fallback quickly
 * for both an XHR GET and a navigation POST, without hanging or retrying.
 *
 * Run as its own process (fresh module + env): tsx --test test/clerkProxyReset.test.ts
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net, { type AddressInfo, type Socket } from "node:net";

process.env.NODE_ENV = "production";
process.env.CLERK_SECRET_KEY = "sk_test_dummy";
process.env.LOG_LEVEL = "silent";

let upstream: net.Server;
let server: http.Server;
let baseUrl: string;

before(async () => {
  // Upstream that accepts the TCP connection then resets it → ECONNRESET.
  upstream = net.createServer((socket: Socket) => {
    socket.destroy();
  });
  const upstreamPort = await new Promise<number>((resolve) => {
    upstream.listen(0, "127.0.0.1", () =>
      resolve((upstream.address() as AddressInfo).port),
    );
  });
  process.env.CLERK_FAPI_URL = `http://127.0.0.1:${upstreamPort}`;

  const express = (await import("express")).default;
  const { clerkProxyMiddleware, CLERK_PROXY_PATH } = await import(
    "../src/middlewares/clerkProxyMiddleware"
  );

  const app = express();
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

  server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  upstream?.close();
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

test("XHR GET hitting a post-connect reset returns 503 without retrying or hanging", async () => {
  const res = await request({
    method: "GET",
    path: "/api/__clerk/v1/client",
    headers: { accept: "application/json" },
  });

  assert.equal(res.status, 503);
  const json = JSON.parse(res.body);
  assert.equal(json.error, "clerk_upstream_unavailable");
  // ECONNRESET is a post-connect error: not retried, so no backoff and no hang.
  assert.ok(
    res.elapsedMs < 1500,
    `post-connect reset must not retry/hang, took ${res.elapsedMs}ms`,
  );
});

test("navigation POST hitting a post-connect reset redirects without retrying", async () => {
  const res = await request({
    method: "POST",
    path: "/api/__clerk/v1/oauth_callback",
    headers: { "sec-fetch-mode": "navigate" },
  });

  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "/sign-in?auth_error=connection");
  assert.ok(
    res.elapsedMs < 1500,
    `post-connect reset must not retry/hang, took ${res.elapsedMs}ms`,
  );
});
