import { describe, it, expect, vi } from 'vitest';
import { runMetricsShow } from '../src/commands/metrics-show.js';
import type { EdgeFetcher } from '../src/edge-client.js';

function fetcherReturning(body: unknown, ok = true, status = 200): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok, status, json: async () => body })) };
}

const BASE_OPTS = { product: 'json-workbench', edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', json: true };

describe('runMetricsShow', () => {
  it('returns 2 when neither --edge-url nor APPFORGE_EDGE_URL is set', async () => {
    const code = await runMetricsShow({ product: 'json-workbench', json: true });
    expect(code).toBe(2);
  });

  it('returns 2 when neither --edge-token nor APPFORGE_EDGE_TOKEN is set', async () => {
    const code = await runMetricsShow({ product: 'json-workbench', edgeUrl: 'https://edge.example.com', json: true });
    expect(code).toBe(2);
  });

  it('falls back to APPFORGE_EDGE_URL/APPFORGE_EDGE_TOKEN env vars when flags are absent', async () => {
    process.env.APPFORGE_EDGE_URL = 'https://edge.example.com';
    process.env.APPFORGE_EDGE_TOKEN = 'dev-only-placeholder-token';
    try {
      const fetcher = fetcherReturning({ metrics: [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 5, source: 'cws_csv' }] });
      const code = await runMetricsShow({ product: 'json-workbench', json: true }, { fetcher });
      expect(code).toBe(0);
    } finally {
      delete process.env.APPFORGE_EDGE_URL;
      delete process.env.APPFORGE_EDGE_TOKEN;
    }
  });

  it('returns 0 and the rows on a successful, non-empty response', async () => {
    const rows = [{ product: 'json-workbench', date: '2026-09-01', name: 'installs', value: 5, source: 'cws_csv' }];
    const fetcher = fetcherReturning({ metrics: rows });
    const code = await runMetricsShow(BASE_OPTS, { fetcher });
    expect(code).toBe(0);
  });

  it('returns 14 (data gap) when the edge returns zero rows for a valid product (Review Focus)', async () => {
    const fetcher = fetcherReturning({ metrics: [] });
    const code = await runMetricsShow(BASE_OPTS, { fetcher });
    expect(code).toBe(14);
  });

  it('returns 17 when the edge rejects the token (Review Focus: auth failure is distinct from data gap)', async () => {
    const fetcher = fetcherReturning({ error: 'unauthorized' }, false, 401);
    const code = await runMetricsShow(BASE_OPTS, { fetcher });
    expect(code).toBe(17);
  });

  it('returns 17 when the fetcher throws (network error), not an uncaught rejection', async () => {
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) };
    const code = await runMetricsShow(BASE_OPTS, { fetcher });
    expect(code).toBe(17);
  });

  it('passes --name and --since through to the edge client as name/from', async () => {
    const fetcher = fetcherReturning({ metrics: [{ product: 'json-workbench', date: '2026-09-02', name: 'installs', value: 3, source: 'cws_csv' }] });
    await runMetricsShow({ ...BASE_OPTS, name: 'installs', since: '2026-09-02' }, { fetcher });
    const [url] = (fetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('name=installs');
    expect(url).toContain('from=2026-09-02');
  });
});
