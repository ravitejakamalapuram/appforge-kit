import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runReportWeekly } from '../src/commands/report-weekly.js';
import type { EdgeFetcher } from '../src/edge-client.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './report-pnl-fixture.json');

function emptyFetcher(): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ metrics: [] }) })) };
}

const BASE = { product: ['json-workbench'], since: '2026-09-01', edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', json: true };

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; stdout: string }> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
  const originalLog = console.log;
  console.log = ((chunk: string) => { chunks.push(String(chunk)); }) as typeof console.log;
  return fn().then((code) => {
    process.stdout.write = originalWrite;
    console.log = originalLog;
    return { code, stdout: chunks.join('\n') };
  });
}

describe('runReportWeekly', () => {
  it('returns 2 when no --product is given', async () => {
    const code = await runReportWeekly({ ...BASE, product: [] }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 2 when no edge URL is resolvable', async () => {
    const code = await runReportWeekly({ ...BASE, edgeUrl: undefined }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 0 with an honest empty portfolio table entry when a product has no metrics/pnl data', async () => {
    const { code, stdout } = await captureStdout(() => runReportWeekly(BASE, { fetcher: emptyFetcher() }));
    expect(code).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.data.portfolio).toEqual([{ product: 'json-workbench', wau: null, d7Retention: null, d30Retention: null, revenueCents: null, contributionCents: null }]);
  });

  it('includes real revenue/contribution numbers from --pnl-fixture', async () => {
    const { stdout } = await captureStdout(() => runReportWeekly({ ...BASE, pnlFixture: FIXTURE }, { fetcher: emptyFetcher() }));
    const output = JSON.parse(stdout);
    expect(output.data.portfolio[0].revenueCents).toBe(865);
  });

  it('prints the human-readable weekly report text in non-JSON mode', async () => {
    const { stdout } = await captureStdout(() => runReportWeekly({ ...BASE, json: false }, { fetcher: emptyFetcher() }));
    expect(stdout).toContain('PORTFOLIO PERFORMANCE');
    expect(stdout).toContain('NEXT WEEK PRIORITIES');
  });

  it('returns 17 when the edge rejects the token', async () => {
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) };
    const code = await runReportWeekly(BASE, { fetcher });
    expect(code).toBe(17);
  });

  it('returns 2 for a --pnl-fixture with a string amount_cents instead of reporting a string-concatenated cost as ok:true (Critical finding regression)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-report-weekly-badfixture-'));
    try {
      const bad = path.join(dir, 'bad.json');
      writeFileSync(bad, JSON.stringify({ revenue: [], costs: [{ id: 'c1', product_id: 'json-workbench', category: 'ai', amount_cents: '120', occurred_at: '2026-09-01' }] }));
      const code = await runReportWeekly({ ...BASE, pnlFixture: bad }, { fetcher: emptyFetcher() });
      expect(code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
