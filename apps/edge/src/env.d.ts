// Ambient augmentation point `@cloudflare/vitest-pool-workers/types` uses for `cloudflare:test`'s
// `env` export (typed as `Cloudflare.Env`) — this is the single source of truth for this
// Worker's bindings; `index.ts`'s exported `Env` type derives from it.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    APPFORGE_ENV: string;
    INGEST_ADMIN_TOKEN: string;
  }
}
