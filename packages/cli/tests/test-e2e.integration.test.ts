import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTestE2e } from '../src/commands/test-e2e.js';

const CHROME_VANILLA_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../templates/chrome-vanilla/dist'
);

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-test-e2e-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('runTestE2e', () => {
  it('returns 2 when --dist has no manifest.json, without opening a browser (Review Focus)', async () => {
    expect(await runTestE2e({ dir: '.', dist: dir, json: true })).toBe(2);
  });

  it('returns 2 when the build step fails, without attempting to run the e2e suite', async () => {
    const buildDir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-test-e2e-build-fail-'));
    try {
      writeFileSync(
        path.join(buildDir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { build: 'node -e "process.exit(1)"' } })
      );
      expect(await runTestE2e({ dir: buildDir, json: true })).toBe(2);
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });

  it('runs the real e2e suite against the built chrome-vanilla template and returns 0 (the one real, unmocked CLI-to-browser run)', async () => {
    expect(await runTestE2e({ dir: '.', dist: CHROME_VANILLA_DIST, json: true })).toBe(0);
  }, 30_000);
});
