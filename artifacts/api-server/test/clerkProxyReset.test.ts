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
let upstreamClosed = false;

// The proxy's degrade alert is a plain `logger.error` line. Because the
// middleware holds the same singleton `logger` instance we import here,
// temporarily swapping `logger.error` lets us capture exactly what it logged
// without depending on stdout/transport wiring (the logger runs at LOG_LEVEL
// silent in this suite). Each captured entry keeps the structured first arg so
// we can assert on the `event` marker and the message independently.
interface LoggedError {
  obj: Record<string, unknown> | undefined;
  msg: string | undefined;
}

async function captureLoggerErrors(
  fn: () => Promise<void>,
): Promise<LoggedError[]> {
  const { logger } = await import("../src/lib/logger");
  const captured: LoggedError[] = [];
  const original = logger.error.bind(logger);
  (logger as { error: (...args: unknown[]) => void }).error = (
    ...args: unknown[]
  ) => {
    const [first, second] = args;
    if (first && typeof first === "object") {
      captured.push({
        obj: first as Record<string, unknown>,
        msg: typeof second === "string" ? second : undefined,
      });
    } else {
      captured.push({ obj: undefined, msg: typeof first === "string" ? first : undefined });
    }
  };
  try {
    await fn();
  } finally {
    (logger as { error: typeof original }).error = original;
  }
  return captured;
}

function degradedMarkers(entries: LoggedError[]): LoggedError[] {
  return entries.filter(
    (e) => e.obj?.event === "clerk_proxy_callback_degraded",
  );
}

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
  if (!upstreamClosed) {
    upstreamClosed = true;
    upstream?.close();
  }
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

test("Apple form_post degrade emits the escalated alert log marker", async () => {
  // The team configures a deployment-log alert on this exact line, so the
  // marker's presence and shape are part of the contract: an un-retryable
  // ECONNRESET on the Apple `response_mode=form_post` navigation POST must emit
  // a dedicated, severity-elevated `event=clerk_proxy_callback_degraded` line.
  const captured = await captureLoggerErrors(async () => {
    const res = await request({
      method: "POST",
      path: "/api/__clerk/v1/oauth_callback",
      headers: { "sec-fetch-mode": "navigate" },
    });
    assert.equal(res.status, 302);
  });

  const markers = degradedMarkers(captured);
  assert.equal(
    markers.length,
    1,
    `expected exactly one degraded alert marker, got ${markers.length}`,
  );
  const [marker] = markers;
  assert.equal(marker.obj?.event, "clerk_proxy_callback_degraded");
  assert.equal(marker.obj?.code, "ECONNRESET");
  assert.match(
    marker.msg ?? "",
    /ALERT clerk proxy callback degraded/,
  );
});

test("retryable GET failure does NOT emit the degraded alert marker", async () => {
  // Close the upstream so fresh connections are refused → ECONNREFUSED, which
  // IS retryable. A GET is idempotent and never an Apple form_post, so however
  // it fails it must never trip the degrade alert — only un-retryable
  // navigation POSTs do. Runs last because it tears down the shared upstream.
  await new Promise<void>((resolve) => {
    upstreamClosed = true;
    upstream.close(() => resolve());
  });

  const captured = await captureLoggerErrors(async () => {
    const res = await request({
      method: "GET",
      path: "/api/__clerk/v1/client",
      headers: { accept: "application/json" },
    });
    assert.equal(res.status, 503);
  });

  // The generic "clerk proxy upstream error" line should have been logged at
  // least once (proving the failure path ran), but with willRetry true and
  // degraded false — and no escalated marker at all.
  assert.ok(
    captured.some((e) => e.obj?.willRetry === true && e.obj?.degraded === false),
    "expected a retryable, non-degraded upstream error to be logged",
  );
  assert.equal(
    degradedMarkers(captured).length,
    0,
    "a retryable GET failure must not emit the degraded alert marker",
  );
});
