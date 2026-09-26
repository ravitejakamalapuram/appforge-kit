/**
 * D1 schema (master plan §29d, scoped to what this plan's endpoints use — see Global
 * Constraints). Single source for both tests (env.DB.exec, via tests/test-helpers.ts) and the
 * one-time real-database migration (scripts/apply-schema.ts, Task 6).
 *
 * Each statement MUST be a single line: D1's `Database.exec()` treats a newline as a statement
 * boundary (not a semicolon), so a multi-line template literal here would silently split one
 * CREATE TABLE into several incomplete fragments — caught by Task 3's tests, which are the
 * first ones to actually call applySchema() against a real (Miniflare-simulated) D1 binding.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS events_raw (install_id TEXT NOT NULL, seq INTEGER NOT NULL, product TEXT NOT NULL, app_version TEXT, env TEXT NOT NULL, event TEXT NOT NULL, props TEXT, ts INTEGER NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY (install_id, seq))`,
  `CREATE INDEX IF NOT EXISTS ev_prod_ts ON events_raw(product, ts)`,
  `CREATE TABLE IF NOT EXISTS metrics_daily (product TEXT, date TEXT, name TEXT, value REAL, source TEXT, PRIMARY KEY (product, date, name, source))`,
  `CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, product TEXT, source TEXT, rating INTEGER, text_hash TEXT, category TEXT, cluster_key TEXT, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS product_config (product TEXT PRIMARY KEY, config TEXT NOT NULL, updated_at TEXT NOT NULL)`,
];
