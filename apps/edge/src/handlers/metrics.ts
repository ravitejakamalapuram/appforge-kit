import type { D1Database } from '@cloudflare/workers-types';

export async function handleGetMetrics(url: URL, db: D1Database): Promise<Response> {
  const product = url.searchParams.get('product');
  if (!product) {
    return Response.json({ error: 'product is required' }, { status: 400 });
  }
  const name = url.searchParams.get('name');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let query = 'SELECT product, date, name, value, source FROM metrics_daily WHERE product = ?';
  const bindings: unknown[] = [product];
  if (name) {
    query += ' AND name = ?';
    bindings.push(name);
  }
  if (from) {
    query += ' AND date >= ?';
    bindings.push(from);
  }
  if (to) {
    query += ' AND date <= ?';
    bindings.push(to);
  }
  query += ' ORDER BY date ASC';

  const { results } = await db.prepare(query).bind(...bindings).all();
  return Response.json({ metrics: results });
}
