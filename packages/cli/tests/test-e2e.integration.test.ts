import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
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

  it('reports a runtime-gap error (not a build failure) when no package manager is on PATH — regardless of whether pnpm is installed here (APP-195)', () => {
    const buildDir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-test-e2e-no-pm-'));
    const binPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
    try {
      writeFileSync(
        path.join(buildDir, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { build: 'node -e "process.exit(1)"' } })
      );

      // Strip PATH down to nothing so neither pnpm nor npm resolves, simulating the agent
      // runtime gap this ticket is about without depending on the host's actual toolchain.
      let error: { status: number | null; stdout: Buffer } | undefined;
      try {
        execFileSync(process.execPath, [binPath, 'test', '--e2e', '--dir', buildDir, '--json'], {
          env: { ...process.env, PATH: '' },
          timeout: 10_000,
        });
      } catch (err) {
        error = err as { status: number | null; stdout: Buffer };
      }

      expect(error).toBeDefined();
      expect(error!.status).toBe(2);
      const output = JSON.parse(error!.stdout.toString());
      expect(output.errors.join(' ')).toMatch(/package manager/i);
      expect(output.errors.join(' ')).not.toMatch(/build failed/i);
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });

  it('runs the real e2e suite against the built chrome-vanilla template and returns 0 (the one real, unmocked CLI-to-browser run)', async () => {
    expect(await runTestE2e({ dir: '.', dist: CHROME_VANILLA_DIST, json: true })).toBe(0);
  }, 30_000);

  it('returns 4 (not 9 -- reserved for `route` per the master plan §29c table) when a check fails', async () => {
    const brokenDir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-test-e2e-broken-'));
    try {
      cpSync(CHROME_VANILLA_DIST, brokenDir, { recursive: true });
      const manifestPath = path.join(brokenDir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.background.service_worker = 'this-file-does-not-exist.js'; // service worker never appears
      writeFileSync(manifestPath, JSON.stringify(manifest));

      expect(await runTestE2e({ dir: '.', dist: brokenDir, json: true })).toBe(4);
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('the real CLI process exits promptly on a launch failure instead of hanging (Review: final-review finding C2)', () => {
    const brokenDir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-test-e2e-hang-'));
    const binPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
    try {
      cpSync(CHROME_VANILLA_DIST, brokenDir, { recursive: true });
      const manifestPath = path.join(brokenDir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.background.service_worker = 'this-file-does-not-exist.js';
      writeFileSync(manifestPath, JSON.stringify(manifest));

      // A real, separate Node process. If the browser context/temp profile leaks, this process
      // never exits on its own and execFileSync's `timeout` kills it (SIGTERM), which surfaces
      // as a `status: null, signal: 'SIGTERM'` error here instead of a normal non-zero exit.
      let error: { status: number | null; signal: string | null } | undefined;
      try {
        execFileSync(process.execPath, [binPath, 'test', '--e2e', '--dist', brokenDir, '--json'], {
          timeout: 20_000,
        });
      } catch (err) {
        error = err as { status: number | null; signal: string | null };
      }
      expect(error).toBeDefined();
      expect(error!.signal).toBeNull(); // null signal means the process exited on its own, not killed by the timeout
      expect(error!.status).toBe(4);
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  }, 25_000);
});
