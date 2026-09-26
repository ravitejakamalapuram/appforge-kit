import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

const VALID_TOKEN = 'dev-only-placeholder-token';

function get(path: string, token: string = VALID_TOKEN) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

beforeEach(async () => {
  await applySchema(env.DB);
  await env.DB.prepare(
    `INSERT INTO metrics_daily (product, date, name, value, source) VALUES (?, ?, ?, ?, ?)`
  ).bind('json-workbench', '2026-09-01', 'installs', 12, 'cws_csv').run();
  await env.DB.prepare(
    `INSERT INTO metrics_daily (product, date, name, value, source) VALUES (?, ?, ?, ?, ?)`
  ).bind('json-workbench', '2026-09-02', 'installs', 15, 'cws_csv').run();
});

describe('GET /v1/metrics', () => {
  it('returns metrics rows for the requested product when authorized', async () => {
    const response = await get('/v1/metrics?product=json-workbench');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { metrics: unknown[] };
    expect(body.metrics).toHaveLength(2);
  });

  it('filters by name and date range', async () => {
    const response = await get('/v1/metrics?product=json-workbench&name=installs&from=2026-09-02');
    const body = (await response.json()) as { metrics: unknown[] };
    expect(body.metrics).toEqual([
      { product: 'json-workbench', date: '2026-09-02', name: 'installs', value: 15, source: 'cws_csv' },
    ]);
  });

  it('returns 400 when product is missing', async () => {
    const response = await get('/v1/metrics');
    expect(response.status).toBe(400);
  });

  it('rejects a request without a valid admin bearer token (§29e: reads require a bearer token)', async () => {
    const response = await get('/v1/metrics?product=json-workbench', 'wrong-token');
    expect(response.status).toBe(401);
  });
});
