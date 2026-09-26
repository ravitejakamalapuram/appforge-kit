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

  it('returns 2 for a non-finite or non-positive maxKb instead of a silently-always-failing comparison (Review Focus)', () => {
    const distDir = makeDist('bad-max-kb', { 'index.js': 'a' });
    expect(runSecurityBundleSize({ distDir, maxKb: NaN, json: true })).toBe(2);
    expect(runSecurityBundleSize({ distDir, maxKb: -5, json: true })).toBe(2);
    expect(runSecurityBundleSize({ distDir, maxKb: 0, json: true })).toBe(2);
  });

  it('is ok exactly at the budget boundary', () => {
    const distDir = makeDist('exact-boundary', { 'index.js': 'a'.repeat(1024) });
    expect(runSecurityBundleSize({ distDir, maxKb: 1, json: true })).toBe(0);
  });
});
