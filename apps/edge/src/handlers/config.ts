import type { D1Database } from '@cloudflare/workers-types';

export async function handleGetConfig(product: string, db: D1Database): Promise<Response> {
  const row = await db
    .prepare('SELECT config FROM product_config WHERE product = ?')
    .bind(product)
    .first<{ config: string }>();
  if (!row) return Response.json({});
  return Response.json(JSON.parse(row.config));
}
