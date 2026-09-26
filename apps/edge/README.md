# appforge-edge

Cloudflare Worker + D1 backend for AppForge products: telemetry ingest, remote config,
feedback, and metrics. See the master plan §18b/§29d/§29e.

Live at: https://appforge-edge.echokit-rk.workers.dev

## Endpoints

- `GET /__health` — liveness check.
- `POST /v1/events` — batch event ingest (≤ 50 events/request), idempotent on `(install_id, seq)`,
  allowlist-enforced per product (see `src/allowlist.ts`).
- `GET /v1/metrics?product&name&from&to` — query `metrics_daily`.
- `POST /v1/feedback` — store user feedback (text is hashed, not retained raw — see `src/handlers/feedback.ts`).
- `GET /v1/config/:product` — remote config JSON for `@appforge/flags`.
- `POST /v1/ingest/:source` — admin-gated (`Authorization: Bearer <INGEST_ADMIN_TOKEN>`) upsert into `metrics_daily`.

## Local development

```bash
pnpm install
pnpm --filter @appforge/edge test    # runs against a local, Miniflare-simulated D1 — no network
pnpm --filter @appforge/edge dev     # wrangler dev, also local
```

`INGEST_ADMIN_TOKEN`'s local/test value lives in `.dev.vars` (gitignored) — it is not a
`wrangler.toml` `[vars]` entry, because Cloudflare refuses to let the same binding name be both
a plaintext var and a `wrangler secret put`-managed secret at once.

## Deploying

```bash
node --experimental-strip-types scripts/apply-schema.ts --remote   # once, or after a schema change
pnpm --filter @appforge/edge run deploy
```

The real `INGEST_ADMIN_TOKEN` is set once via `wrangler secret put INGEST_ADMIN_TOKEN` (pipe a
freshly generated value into it — e.g. `openssl rand -hex 32 | wrangler secret put
INGEST_ADMIN_TOKEN` — never paste the value into a chat, PR, or shell history you don't control).

## Deliberately out of scope (see the P1-10 plan's Global Constraints)

- Separate staging/prod D1 databases — one database until a real product depends on this Worker.
- `releases`, `incidents`, `revenue`, `costs`, `ai_usage`, `product_state_log` tables — later backlog items (P1-13, P1-15).
- Raw feedback text storage / the weekly feedback classifier — P2-02.
- CI-driven deploys — deploys are manual (`wrangler deploy`) until a product's release actually depends on this Worker being current.
