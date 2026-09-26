import type { D1Database } from '@cloudflare/workers-types';

interface MetricRowInput {
  product: unknown;
  date: unknown;
  name: unknown;
  value: unknown;
}

function validateRow(input: unknown): { product: string; date: string; name: string; value: number } | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as MetricRowInput;
  if (typeof r.product !== 'string' || r.product.length === 0) return null;
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return null;
  if (typeof r.name !== 'string' || r.name.length === 0) return null;
  if (typeof r.value !== 'number' || !Number.isFinite(r.value)) return null;
  return { product: r.product, date: r.date, name: r.name, value: r.value };
}

const MIN_ADMIN_TOKEN_LENGTH = 16;

// Fails closed if the configured token is missing/too short (e.g. a secret that was never set)
// rather than comparing against `Bearer undefined` or `Bearer ` — a caller who happens to send
// that literal string must never be treated as authorized.
export function isAuthorized(request: Request, adminToken: string): boolean {
  if (typeof adminToken !== 'string' || adminToken.length < MIN_ADMIN_TOKEN_LENGTH) return false;
  const header = request.headers.get('Authorization') ?? '';
  return header === `Bearer ${adminToken}`;
}

export async function handleIngest(request: Request, source: string, db: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: 'body must be an array of metric rows' }, { status: 400 });
  }
  let upserted = 0;
  for (const raw of body) {
    const row = validateRow(raw);
    if (!row) continue;
    await db
      .prepare(
        `INSERT INTO metrics_daily (product, date, name, value, source) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(product, date, name, source) DO UPDATE SET value = excluded.value`
      )
      .bind(row.product, row.date, row.name, row.value, source)
      .run();
    upserted++;
  }
  return Response.json({ upserted }, { status: 202 });
}
