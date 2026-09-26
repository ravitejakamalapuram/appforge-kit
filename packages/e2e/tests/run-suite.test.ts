import { describe, it, expect } from 'vitest';
import { runE2eSuite } from '../src/index.js';
import { CHROME_VANILLA_DIST } from './fixture.js';

describe('runE2eSuite', () => {
  it('runs both checks against the chrome-vanilla template and reports ok', async () => {
    const report = await runE2eSuite(CHROME_VANILLA_DIST);
    expect(report.buildDir).toBe(CHROME_VANILLA_DIST);
    expect(report.checks).toHaveLength(2);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(report.checks.every((c) => c.durationMs >= 0)).toBe(true);
    expect(report.ok).toBe(true);
  }, 30_000);

  it('reports ok: false with the specific check(s) that failed, not a thrown exception, for a bad buildDir', async () => {
    const report = await runE2eSuite('/nonexistent/path/does-not-exist');
    // launchExtension itself throws (no extension there to load) — the whole suite reports
    // failure via one synthetic "suite setup" entry rather than propagating the exception, so a
    // CLI caller always gets a report to print instead of having to catch.
    expect(report.ok).toBe(false);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0].ok).toBe(false);
    expect(report.checks[0].name).toBe('suite setup: launch the extension');
  }, 15_000);
});
