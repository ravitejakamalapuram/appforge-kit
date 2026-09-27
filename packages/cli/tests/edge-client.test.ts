import { describe, it, expect, vi } from 'vitest';
import { EdgeClient, EdgeRequestError, type EdgeFetcher } from '../src/edge-client.js';

function fakeFetcher(response: { ok: boolean; status: number; body: unknown }): EdgeFetcher & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(async () => ({
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    })),
  };
}

describe('EdgeClient.getMetrics', () => {
  it('builds the request URL with product/name/from/to and sends the bearer token', async () => {
    const fetcher = fakeFetcher({ ok: true, status: 200, body: { metrics: [] } });
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', fetcher });

    await client.getMetrics({ product: 'json-workbench', name: 'installs', from: '2026-09-01', to: '2026-09-30' });

    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.fetch.mock.calls[0];
    expect(url).toBe(
      'https://edge.example.com/v1/metrics?product=json-workbench&name=installs&from=2026-09-01&to=2026-09-30'
    );
    expect(init.headers.Authorization).toBe('Bearer dev-only-placeholder-token');
  });

  it('omits optional query params when not given', async () => {
    const fetcher = fakeFetcher({ ok: true, status: 200, body: { metrics: [] } });
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 't', fetcher });

    await client.getMetrics({ product: 'json-workbench' });

    const [url] = fetcher.fetch.mock.calls[0];
    expect(url).toBe('https://edge.example.com/v1/metrics?product=json-workbench');
  });

  it('returns the metrics array from a successful response, matching apps/edge/tests/metrics.test.ts\'s shape', async () => {
    const rows = [{ product: 'json-workbench', date: '2026-09-02', name: 'installs', value: 15, source: 'cws_csv' }];
    const fetcher = fakeFetcher({ ok: true, status: 200, body: { metrics: rows } });
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 't', fetcher });

    const result = await client.getMetrics({ product: 'json-workbench' });

    expect(result).toEqual(rows);
  });

  it('throws EdgeRequestError with the status on a non-2xx response (Review Focus: unauthorized/5xx)', async () => {
    const fetcher = fakeFetcher({ ok: false, status: 401, body: { error: 'unauthorized' } });
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 'wrong', fetcher });

    await expect(client.getMetrics({ product: 'json-workbench' })).rejects.toMatchObject({
      status: 401,
    });
    await expect(client.getMetrics({ product: 'json-workbench' })).rejects.toBeInstanceOf(EdgeRequestError);
  });

  it('throws EdgeRequestError (not an uncaught rejection) when the fetcher itself throws, e.g. network down (Review Focus)', async () => {
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) };
    const client = new EdgeClient({ edgeUrl: 'https://edge.example.com', edgeToken: 't', fetcher });

    await expect(client.getMetrics({ product: 'json-workbench' })).rejects.toBeInstanceOf(EdgeRequestError);
  });
});
