import type { D1Database } from '@cloudflare/workers-types';
import { SCHEMA_STATEMENTS } from '../src/schema.js';

export async function applySchema(db: D1Database): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.exec(statement);
  }
}
