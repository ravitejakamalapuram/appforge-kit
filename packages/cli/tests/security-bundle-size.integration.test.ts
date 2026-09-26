import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSecurityBundleSize } from '../src/commands/security-bundle-size.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-security-bundle-size-test-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function makeDist(name: string, files: Record<string, string>): string {
  const distDir = path.join(dir, name);
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(distDir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return distDir;
}

describe('runSecurityBundleSize', () => {
  it('returns 0 when the total size (excluding .map files) is under budget', () => {
    const distDir = makeDist('under-budget', { 'index.js': 'a'.repeat(100) });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(0); // 100 bytes < 1024
  });

  it('returns 9 when the total size exceeds budget', () => {
    const distDir = makeDist('over-budget', { 'index.js': 'a'.repeat(2000) });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(9); // 2000 bytes > 1024
  });

  it('excludes .map files from the total (Review Focus: a huge source map must not blow the budget)', () => {
    const distDir = makeDist('with-sourcemap', {
      'index.js': 'a'.repeat(100),
      'index.js.map': 'x'.repeat(50_000),
    });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(0);
  });

  it('recursively sums files in subdirectories (Review Focus)', () => {
    const distDir = makeDist('nested', {
      'manifest.json': 'a'.repeat(50),
      'assets/index.js': 'b'.repeat(50),
      'src/newtab/index.html': 'c'.repeat(50),
    });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(0);
    const result = runSecurityBundleSize({ distDir, maxKb: 0.1, json: true }); // 102.4 bytes budget, 150 actual
    expect(result).toBe(9);
  });

  it('returns 2 for a dist directory that does not exist, not a crash (Review Focus)', () => {
    expect(runSecurityBundleSize({ distDir: path.join(dir, 'does-not-exist'), maxKb: 100, json: true })).toBe(2);
  });

  it('returns 2 for a non-finite or negative maxKb instead of a silently-always-failing comparison (Review Focus)', () => {
    const distDir = makeDist('bad-max-kb', { 'index.js': 'a' });
    expect(runSecurityBundleSize({ distDir, maxKb: NaN, json: true })).toBe(2);
    expect(runSecurityBundleSize({ distDir, maxKb: -5, json: true })).toBe(2);
  });

  it('is ok exactly at the budget boundary', () => {
    const distDir = makeDist('exact-boundary', { 'index.js': 'a'.repeat(1024) });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(0);
  });

  it('maxKb 0 means report-only: never fails regardless of size, and marks the result unenforced (fix for Critical review finding: a single global default budget cannot fit every real app, e.g. json-workbench bundles Monaco+DuckDB WASM at ~48.8MB)', () => {
    const distDir = makeDist('report-only-huge', { 'index.js': 'a'.repeat(500_000) });
    expect(runSecurityBundleSize({ distDir, maxKb: 0, json: true })).toBe(0);
  });

  it('maxKb 0 report-only still reports the real totalBytes (not silently 0) so the PR comment stays informative', () => {
    const distDir = makeDist('report-only-visible', { 'index.js': 'a'.repeat(250) });
    const capture = { out: '' };
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { capture.out += chunk; return true; }) as typeof process.stdout.write;
    try {
      runSecurityBundleSize({ distDir, maxKb: 0, json: true });
    } finally {
      process.stdout.write = originalWrite;
    }
    const parsed = JSON.parse(capture.out.trim());
    expect(parsed.data.totalBytes).toBe(250);
    expect(parsed.data.enforced).toBe(false);
  });
});
