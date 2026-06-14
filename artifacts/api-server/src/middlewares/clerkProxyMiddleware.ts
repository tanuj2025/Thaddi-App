/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * AUTH CONFIGURATION: To manage users, enable/disable login providers
 * (Google, GitHub, etc.), change app branding, or configure OAuth credentials,
 * use the Auth pane in the workspace toolbar. There is no external Clerk
 * dashboard — all auth configuration is done through the Auth pane.
 *
 * IMPORTANT:
 * - Only active in production (Clerk proxying doesn't work for dev instances)
 * - Must be mounted BEFORE express.json() middleware
 *
 * RELIABILITY:
 * Without an error handler, http-proxy-middleware emits a bare
 * `500 text/plain "Internal Server Error"` whenever the upstream connection to
 * Clerk blips. During an OAuth callback that lands the user on a raw error page
 * mid sign-in. Apple is hit hardest because it uses `response_mode=form_post`
 * (a top-level POST navigation) which is more sensitive to connection failures
 * than Google's GET redirect. To absorb transient blips we:
 *   1. reuse upstream connections via a keep-alive HTTPS agent,
 *   2. fail fast with a bounded proxy timeout instead of hanging, and
 *   3. handle upstream errors deliberately — redirect browser navigations back
 *      to the sign-in page (retryable) and return clean JSON to XHR/fetch,
 *      with a safe automatic retry for idempotent requests only (never the
 *      one-time Apple authorization-code POST).
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import { createProxyMiddleware } from "http-proxy-middleware";
import type { RequestHandler } from "express";
import * as https from "node:https";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";
import { logger } from "../lib/logger";

const CLERK_FAPI_DEFAULT = "https://frontend-api.clerk.dev";

/**
 * Resolve the upstream target. Defaults to Clerk's Frontend API. A
 * CLERK_FAPI_URL override exists purely so the proxy's failure handling can be
 * exercised in tests against a controllable local server, and it is honoured
 * ONLY when it points at loopback. This is a safety boundary: every proxied
 * request carries the Clerk-Secret-Key, so a production misconfiguration must
 * never be able to redirect that secret to an arbitrary host — any non-loopback
 * value is ignored in favour of the real Clerk endpoint.
 */
function resolveClerkFapi(): string {
  const override = process.env.CLERK_FAPI_URL?.trim();
  if (
    override &&
    /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(override)
  ) {
    return override;
  }
  return CLERK_FAPI_DEFAULT;
}

const CLERK_FAPI = resolveClerkFapi();
const CLERK_FAPI_IS_HTTPS = CLERK_FAPI.startsWith("https:");
export const CLERK_PROXY_PATH = "/api/__clerk";

/**
 * Where to send a browser back to when the upstream call behind an OAuth
 * callback fails. Kept relative on purpose: a relative redirect resolves
 * against whatever host the browser is currently on, so it always stays on the
 * canonical client-facing host (including custom domains) without us having to
 * reconstruct an absolute URL — the safest behaviour for multi-domain flows.
 */
const SIGN_IN_FALLBACK_PATH = "/sign-in?auth_error=connection";

/** Wait at most this long for a response from Clerk before giving up (ms). */
const PROXY_TIMEOUT_MS = 30_000;

/** Only ever retry safe, side-effect-free methods. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Connection-ESTABLISHMENT failures where the request provably never reached
 * Clerk: no socket ever connected, so httpxy never piped the request body. These
 * are the only errors safe to retry — re-running the proxy starts a fresh
 * connection attempt with the request untouched. We deliberately do NOT retry
 * post-connect errors (ECONNRESET / ETIMEDOUT / EPIPE / "socket hang up"):
 * httpxy always pipes `req` into the upstream and relies on its `end` event, so
 * once the stream has been consumed a replay would never finish and would hang.
 * Those cases degrade to the graceful fallback instead.
 */
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

const MAX_PROXY_RETRIES = 2;

/**
 * Reuse upstream TCP/TLS connections to Clerk. Re-handshaking on every request
 * is both slower and a larger transient-failure surface; a keep-alive pool
 * smooths that out. `keepAliveMsecs` stays well under typical edge idle
 * timeouts so we rarely reuse a half-closed socket.
 */
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 100,
  maxFreeSockets: 16,
  timeout: PROXY_TIMEOUT_MS,
});

/**
 * Returns the first effective public hostname for the given request,
 * preferring x-forwarded-host over the Host header so callers behind a
 * proxy see the original client-facing host.
 *
 * x-forwarded-host can take three shapes:
 *   - undefined (no proxy involved)
 *   - a single string (one proxy hop)
 *   - a comma-delimited string when an upstream appended rather than
 *     replaced the header (Node folds duplicate headers this way), or a
 *     string[] in some Express typings
 * In the multi-value case, the leftmost value is the original client-
 * facing host. Take that one in all forms. Exported so that app.ts
 * (clerkMiddleware callback) and this proxy middleware agree on which
 * hostname is canonical — otherwise multi-domain/custom-domain flows
 * break.
 */
export function getClerkProxyHost(req: {
  headers: IncomingHttpHeaders;
}): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = raw?.split(",")[0]?.trim();
  return firstHop || req.headers.host?.trim() || undefined;
}

/**
 * Detect a top-level browser navigation (e.g. the OAuth callback) as opposed to
 * an XHR/fetch from clerk-js. Modern browsers send `Sec-Fetch-Mode: navigate`
 * for navigations; for older clients we fall back to the Accept header and the
 * callback URL shape.
 */
function isBrowserNavigation(req: IncomingMessage): boolean {
  const fetchMode = String(req.headers["sec-fetch-mode"] ?? "").toLowerCase();
  if (fetchMode) return fetchMode === "navigate";
  const accept = String(req.headers["accept"] ?? "").toLowerCase();
  const url = req.url ?? "";
  return accept.includes("text/html") || /oauth_callback|sso-callback|verify/.test(url);
}

/** True when we can still write a clean response on this connection. */
function isResponseWritable(res: ServerResponse | unknown): res is ServerResponse {
  const r = res as ServerResponse;
  return (
    !!r &&
    typeof r.writeHead === "function" &&
    !r.headersSent &&
    !r.writableEnded &&
    !r.destroyed
  );
}

/**
 * Respond deliberately to an upstream failure instead of leaking a bare 500:
 * redirect browser navigations back to the sign-in page (so the user can simply
 * try again), and return a small JSON error to XHR/fetch callers.
 */
function sendProxyFallback(req: IncomingMessage, res: ServerResponse | unknown): void {
  if (!isResponseWritable(res)) {
    // Client already went away (aborted navigation / closed tab). Nothing to do.
    try {
      (res as ServerResponse | undefined)?.destroy?.();
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    if (isBrowserNavigation(req)) {
      res.writeHead(302, {
        Location: SIGN_IN_FALLBACK_PATH,
        "Cache-Control": "no-store",
      });
      res.end();
    } else {
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Retry-After": "1",
      });
      res.end(
        JSON.stringify({
          error: "clerk_upstream_unavailable",
          message:
            "Authentication service is temporarily unavailable. Please try again.",
        }),
      );
    }
  } catch {
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  }
}

export function clerkProxyMiddleware(): RequestHandler {
  // Only run proxy in production — Clerk proxying doesn't work for dev instances
  if (process.env.NODE_ENV !== "production") {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  // Holds the proxy handler so the error callback can safely re-invoke it for
  // idempotent retries. Assigned immediately after creation, long before any
  // request arrives.
  let proxyForRetry:
    | ((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void)
    | undefined;

  const middleware = createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    // Keep-alive only applies to the real HTTPS upstream. The test override may
    // point at a local HTTP server, where an HTTPS agent would not apply.
    agent: CLERK_FAPI_IS_HTTPS ? keepAliveAgent : undefined,
    proxyTimeout: PROXY_TIMEOUT_MS,
    pathRewrite: (path: string) =>
      path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = getClerkProxyHost(req) || "";
        const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}`;

        proxyReq.setHeader("Clerk-Proxy-Url", proxyUrl);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);

        const xff = req.headers["x-forwarded-for"];
        const clientIp =
          (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          "";
        if (clientIp) {
          proxyReq.setHeader("X-Forwarded-For", clientIp);
        }
      },
      error: (err, req, res) => {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        const method = (req.method ?? "GET").toUpperCase();
        const reqAny = req as IncomingMessage & {
          id?: unknown;
          __clerkProxyAttempts?: number;
        };
        const attempts = reqAny.__clerkProxyAttempts ?? 0;

        const writable = isResponseWritable(res);
        // Only retry safe methods, on pre-connect errors (the request body was
        // never sent), while the response is still untouched and the client is
        // still connected. We NEVER retry the Apple form_post POST — replaying
        // it could re-send an already-consumed one-time authorization code.
        const canRetry =
          writable &&
          !!proxyForRetry &&
          IDEMPOTENT_METHODS.has(method) &&
          attempts < MAX_PROXY_RETRIES &&
          RETRYABLE_ERROR_CODES.has(code ?? "") &&
          !req.destroyed;

        logger.error(
          {
            reqId: reqAny.id,
            method,
            url: (req.url ?? "").split("?")[0],
            code,
            attempt: attempts,
            willRetry: canRetry,
            clientGone: !writable,
          },
          "clerk proxy upstream error",
        );

        if (canRetry) {
          reqAny.__clerkProxyAttempts = attempts + 1;
          const delayMs = 100 * (attempts + 1);
          setTimeout(() => {
            // The client may have disconnected during the backoff; re-check
            // before spending another upstream attempt.
            if (!isResponseWritable(res) || req.destroyed) {
              sendProxyFallback(req, res);
              return;
            }
            try {
              proxyForRetry!(req, res as ServerResponse, () =>
                sendProxyFallback(req, res),
              );
            } catch {
              sendProxyFallback(req, res);
            }
          }, delayMs);
          return;
        }

        sendProxyFallback(req, res);
      },
    },
  });

  proxyForRetry = middleware as unknown as typeof proxyForRetry;
  return middleware as unknown as RequestHandler;
}
