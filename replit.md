# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Production go-live checklist

Secrets are global (shared by dev + prod), so rotating one affects both environments.

- `MOYASAR_WEBHOOK_SECRET` (required for the payment webhook) — in the Moyasar dashboard, add a webhook to `https://<prod-domain>/api/payments/moyasar/webhook`, choose a secret token, and store the **same** value here. Until it's set the webhook returns 503 and paid-but-not-activated recovery falls back to the browser callback + reconciler only.
- Moyasar live keys — swap `MOYASAR_SECRET_KEY` / `MOYASAR_PUBLISHABLE_KEY` from test to live before taking real payments.
- Clerk production instance — ensure `CLERK_SECRET_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` resolve to the production Clerk instance for the live host (the web app derives the publishable key per-host via `publishableKeyFromHost`).
- Optional reconciler tuning: `MOYASAR_RECONCILE_INTERVAL_MS` (default 15m), `MOYASAR_RECONCILE_LOOKBACK_MS` (default 72h), `MOYASAR_RECONCILE_PAGES` (default 1, max 20).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Arabic UI copy uses modern Saudi football-fan slang (casual, energetic), NOT formal MSA. Lexicon: ربع=friends, سوِّ=create, ببلاش=free, عزّم=invite, شيّر/بالواتس=share, لايف=live, خمّن=predict, دوّر=search, افتح=open, لين الحين=yet, ما فيه=none, تقفّل=lock, مو=not, هلا=hi. English (`en`) values stay unchanged. Legal/terms/privacy and admin-panel copy stay formal (excluded). Preserve Arabic-Indic digits.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
