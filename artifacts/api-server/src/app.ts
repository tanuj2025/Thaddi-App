import path from "node:path";
import fs from "node:fs";
import express, { type Express, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import * as Sentry from "@sentry/node";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the single platform reverse proxy in front of this server so that
// `req.ip` resolves to the real client address (used by the audit trail)
// instead of an attacker-controlled `x-forwarded-for` value.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk Frontend API proxy. Must be mounted BEFORE body parsers (it streams
// raw bytes). Production-only — a no-op in development.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Same-origin (web) requests through the Replit proxy carry no cross-origin
// risk. For genuine cross-origin callers (e.g. a future mobile bundle) only
// reflect explicitly allow-listed origins when sending credentials, and never
// reflect arbitrary origins in production.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    credentials: true,
    origin(origin, cb) {
      // No Origin header => same-origin or non-browser client: allow.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (process.env.NODE_ENV !== "production") return cb(null, true);
      return cb(null, false);
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Serve iOS Universal Links & Android App Links domain association files.
// The API is run from different working directories in dev (source tree) and
// production (compiled dist), so resolve from both the workspace and package
// roots instead of relying on a single __dirname-relative path.
function associationFile(name: "assetlinks.json" | "apple-app-site-association") {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/thaddi/public/.well-known", name),
    path.resolve(process.cwd(), "../thaddi/public/.well-known", name),
    path.resolve(__dirname, "../../thaddi/public/.well-known", name),
    path.resolve(__dirname, "../../../artifacts/thaddi/public/.well-known", name),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function sendAssociationFile(
  name: "assetlinks.json" | "apple-app-site-association",
  res: Response,
) {
  const p = associationFile(name);
  if (p) {
    res.setHeader("Content-Type", "application/json");
    // sendFile ignores dot-prefixed path segments by default; read the
    // already-validated file directly so `/.well-known/*` is served in both
    // development and production.
    res.send(fs.readFileSync(p, "utf8"));
  } else {
    res.status(404).json({ error: `${name} not found` });
  }
}

app.get("/.well-known/assetlinks.json", (_req, res) =>
  sendAssociationFile("assetlinks.json", res),
);

app.get("/.well-known/apple-app-site-association", (_req, res) =>
  sendAssociationFile("apple-app-site-association", res),
);

app.use("/api", router);

// Register Sentry error handler middleware
Sentry.setupExpressErrorHandler(app);

export default app;
