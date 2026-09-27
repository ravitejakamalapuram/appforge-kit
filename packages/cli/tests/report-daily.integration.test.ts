import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runReportDaily } from '../src/commands/report-daily.js';
import type { EdgeFetcher } from '../src/edge-client.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './report-pnl-fixture.json');

const EDGE_ENV_VARS = ['APPFORGE_EDGE_URL', 'APPFORGE_EDGE_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of EDGE_ENV_VARS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of EDGE_ENV_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function emptyFetcher(): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ metrics: [] }) })) };
}

const BASE = { product: ['json-workbench'], edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token', json: true };

function captureStdout(fn: () => Promise<number>): Promise<{ code: number; stdout: string }> {
  const chunks: string[] = [];
  const original = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  console.log = ((chunk: string) => { chunks.push(String(chunk)); }) as typeof console.log;
  process.stdout.write = ((chunk: string) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
  return fn().then((code) => {
    console.log = original;
    process.stdout.write = originalWrite;
    return { code, stdout: chunks.join('\n') };
  });
}

describe('runReportDaily', () => {
  it('returns 2 when no --product is given', async () => {
    const code = await runReportDaily({ ...BASE, product: [] }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 2 when neither --edge-url nor APPFORGE_EDGE_URL is set', async () => {
    const code = await runReportDaily({ ...BASE, edgeUrl: undefined }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 2 for a malformed --pnl-fixture file', async () => {
    const code = await runReportDaily({ ...BASE, pnlFixture: path.join(path.dirname(FIXTURE), 'does-not-exist.json') }, { fetcher: emptyFetcher() });
    expect(code).toBe(2);
  });

  it('returns 0 and a JSON cli-output@1 payload with honest empty sections when a product has zero metrics and no --pnl-fixture (Review Focus)', async () => {
    const { code, stdout } = await captureStdout(() => runReportDaily(BASE, { fetcher: emptyFetcher() }));
    expect(code).toBe(0);
    const output = JSON.parse(stdout);
    expect(output).toMatchObject({ schema: 'cli-output@1', ok: true, command: 'report daily' });
    expect(output.data.revenueCents).toBeNull();
    expect(output.data.winners).toEqual([]);
  });

  it('returns 0 and includes real pnl numbers when --pnl-fixture matches the product', async () => {
    const { code, stdout } = await captureStdout(() => runReportDaily({ ...BASE, since: '2026-09-01', pnlFixture: FIXTURE }, { fetcher: emptyFetcher() }));
    expect(code).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.data.contributionCents).toBe(1500 - 500 - 135 - 120 - 25);
  });

  it('prints the human-readable §29b-shaped report text (not just pass/fail) in non-JSON mode', async () => {
    const { code, stdout } = await captureStdout(() => runReportDaily({ ...BASE, json: false }, { fetcher: emptyFetcher() }));
    expect(code).toBe(0);
    expect(stdout).toContain('COMPANY HEALTH');
    expect(stdout).toContain('FOUNDER DECISIONS REQUIRED');
  });

  it('returns 17 when the edge rejects the token, not a false-positive successful report (Review Focus)', async () => {
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) };
    const code = await runReportDaily(BASE, { fetcher });
    expect(code).toBe(17);
  });

  it('falls back to APPFORGE_EDGE_URL/APPFORGE_EDGE_TOKEN when flags are absent', async () => {
    process.env.APPFORGE_EDGE_URL = 'https://edge.example.com';
    process.env.APPFORGE_EDGE_TOKEN = 'dev-only-placeholder-token';
    const code = await runReportDaily({ product: ['json-workbench'], json: true }, { fetcher: emptyFetcher() });
    expect(code).toBe(0);
  });

  it('returns 2 for a --pnl-fixture with a string amount_cents instead of reporting a string-concatenated cost as ok:true (Critical finding regression)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-report-daily-badfixture-'));
    try {
      const bad = path.join(dir, 'bad.json');
      writeFileSync(bad, JSON.stringify({ revenue: [], costs: [{ id: 'c1', product_id: 'json-workbench', category: 'ai', amount_cents: '120', occurred_at: '2026-09-01' }] }));
      const code = await runReportDaily({ ...BASE, pnlFixture: bad }, { fetcher: emptyFetcher() });
      expect(code).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
