import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReportDashboard } from '../src/commands/report-dashboard.js';
import type { EdgeFetcher } from '../src/edge-client.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './report-pnl-fixture.json');

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-report-dashboard-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const EDGE_ENV_VARS = ['APPFORGE_EDGE_URL', 'APPFORGE_EDGE_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of EDGE_ENV_VARS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of EDGE_ENV_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function emptyFetcher(): EdgeFetcher {
  return { fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ metrics: [] }) })) };
}

const FIXED_NOW = () => new Date('2026-09-27T12:00:00.000Z');
const EDGE = { edgeUrl: 'https://edge.example.com', edgeToken: 'dev-only-placeholder-token' };

describe('runReportDashboard', () => {
  it('returns 2 when no --product is given', async () => {
    const out = path.join(dir, 'a.html');
    const code = await runReportDashboard({ ...EDGE, product: [], out, aiBudgetCents: 10000, json: true }, { fetcher: emptyFetcher(), now: FIXED_NOW });
    expect(code).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  it('writes a full HTML page to --out and returns 0 with a cli-output@1 {path} confirmation in --json mode', async () => {
    const out = path.join(dir, 'dashboard.html');
    const code = await runReportDashboard(
      { ...EDGE, product: ['json-workbench'], since: '2026-09-01', pnlFixture: FIXTURE, out, aiBudgetCents: 10000, json: true },
      { fetcher: emptyFetcher(), now: FIXED_NOW }
    );
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const html = readFileSync(out, 'utf8');
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('2026-09-27T12:00:00.000Z');
    expect(html).toContain('$8.65'); // net revenue from the shared fixture
  });

  it('returns 17 when the edge rejects the token and writes no file', async () => {
    const out = path.join(dir, 'should-not-exist.html');
    const fetcher: EdgeFetcher = { fetch: vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) };
    const code = await runReportDashboard({ ...EDGE, product: ['json-workbench'], out, aiBudgetCents: 10000, json: true }, { fetcher, now: FIXED_NOW });
    expect(code).toBe(17);
    expect(existsSync(out)).toBe(false);
  });

  it('returns 2 for a malformed --pnl-fixture', async () => {
    const out = path.join(dir, 'b.html');
    const code = await runReportDashboard(
      { ...EDGE, product: ['json-workbench'], pnlFixture: path.join(dir, 'nope.json'), out, aiBudgetCents: 10000, json: true },
      { fetcher: emptyFetcher(), now: FIXED_NOW }
    );
    expect(code).toBe(2);
  });
});
