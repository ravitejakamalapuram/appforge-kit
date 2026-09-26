import { describe, it, expect, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applySchema } from './test-helpers.js';

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
  it('returns metrics rows for the requested product', async () => {
    const response = await SELF.fetch('https://example.com/v1/metrics?product=json-workbench');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { metrics: unknown[] };
    expect(body.metrics).toHaveLength(2);
  });

  it('filters by name and date range', async () => {
    const response = await SELF.fetch(
      'https://example.com/v1/metrics?product=json-workbench&name=installs&from=2026-09-02'
    );
    const body = (await response.json()) as { metrics: unknown[] };
    expect(body.metrics).toEqual([
      { product: 'json-workbench', date: '2026-09-02', name: 'installs', value: 15, source: 'cws_csv' },
    ]);
  });

  it('returns 400 when product is missing', async () => {
    const response = await SELF.fetch('https://example.com/v1/metrics');
    expect(response.status).toBe(400);
  });
});
