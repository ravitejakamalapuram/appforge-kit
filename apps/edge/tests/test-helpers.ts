import type { D1Database } from '@cloudflare/workers-types';
import { SCHEMA_STATEMENTS } from '../src/schema.js';

// D1 storage is not automatically reset between tests in the same file, and
// `CREATE TABLE IF NOT EXISTS` is a no-op once a table exists — so without an explicit clear,
// rows from an earlier test in the same file leak into the next one's assertions.
const TABLES = ['events_raw', 'metrics_daily', 'feedback', 'product_config'] as const;

export async function applySchema(db: D1Database): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.exec(statement);
  }
  for (const table of TABLES) {
    await db.exec(`DELETE FROM ${table}`);
  }
}
