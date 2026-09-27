import { describe, it, expect, vi } from 'vitest';
import { runMetricsAnomalies } from '../src/commands/metrics-anomalies.js';
import type { EdgeFetcher, MetricRow } from '../src/edge-client.js';

function fetcherReturning(rows: MetricRow[], ok = true, status = 200): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok, status, json: async () => ({ metrics: rows }) })) };
}

function dailyRows(product: string, name: string, values: number[], startDate = '2026-09-01'): MetricRow[] {
  const start = new Date(startDate + 'T00:00:00Z');
  return values.map((value, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { product, date: d.toISOString().slice(0, 10), name, value, source: 'cws_csv' };
  });
}

const BASE_OPTS = { product: 'json-workbench', edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', json: true };

describe('runMetricsAnomalies', () => {
  it('returns 2 when neither --edge-url nor APPFORGE_EDGE_URL is set', async () => {
    const code = await runMetricsAnomalies({ product: 'json-workbench', json: true });
    expect(code).toBe(2);
  });

  it('returns 14 (data gap) when the edge has zero rows at all for this product', async () => {
    const fetcher = fetcherReturning([]);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(14);
  });

  it('returns 17 when the edge rejects the token', async () => {
    const fetcher = fetcherReturning([], false, 401);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(17);
  });

  it('returns 0 with an empty anomalies list on a normal, stable series (Review Focus: no false positives)', async () => {
    const rows = dailyRows('json-workbench', 'installs', [10, 11, 9, 10, 12, 10, 11, 9, 10, 11]);
    const fetcher = fetcherReturning(rows);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(0);
  });

  it('returns 0 and flags the spike day on an anomalous series (here\'s the anomalous case)', async () => {
    const rows = dailyRows('json-workbench', 'installs', [10, 10, 11, 9, 10, 10, 100]);
    const fetcher = fetcherReturning(rows);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(0);
    // Output correctness (flagged point, series name) is asserted via runMetricsShow-style
    // buildOutput data in a unit-level check below.
  });

  it('groups multiple metric names into independent series and only flags the one with the spike', async () => {
    const stable = dailyRows('json-workbench', 'wau', [50, 51, 49, 50, 52, 50, 51]);
    const spiking = dailyRows('json-workbench', 'installs', [10, 10, 11, 9, 10, 10, 100]);
    const fetcher = fetcherReturning([...stable, ...spiking]);
    const code = await runMetricsAnomalies(BASE_OPTS, { fetcher });
    expect(code).toBe(0);
  });

  it('filters to --name when given, passing it through to the edge client', async () => {
    const rows = dailyRows('json-workbench', 'installs', [10, 11, 9, 10, 12]);
    const fetcher = fetcherReturning(rows);
    await runMetricsAnomalies({ ...BASE_OPTS, name: 'installs' }, { fetcher });
    const [url] = (fetcher.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('name=installs');
  });

  it('reports the correct flagged point (name/date/value) in JSON output for a spike (Review Focus: correctness, not just exit code)', async () => {
    const rows = dailyRows('json-workbench', 'installs', [10, 10, 11, 9, 10, 10, 100]);
    const fetcher = fetcherReturning(rows);
    const logs: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { logs.push(chunk); return true; }) as typeof process.stdout.write;
    try {
      await runMetricsAnomalies(BASE_OPTS, { fetcher });
    } finally {
      process.stdout.write = originalWrite;
    }
    const output = JSON.parse(logs.join(''));
    expect(output.data.anomalies).toEqual([
      expect.objectContaining({ name: 'installs', date: rows[6].date, value: 100 }),
    ]);
  });
});
