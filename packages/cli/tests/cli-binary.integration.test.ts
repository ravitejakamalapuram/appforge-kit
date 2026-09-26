import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '../dist/index.js');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('appforge CLI binary (commander wiring, not just the exported run* functions)', () => {
  it('exits 0 and prints the version for --version', () => {
    const { code, stdout } = run(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('0.1.0');
  });

  it('exits 2, not commander\'s default 1, when a required option is missing (Review Focus: usage errors stay in the cli-output@1 exit-code table)', () => {
    const { code } = run(['product-transition', '--to', 'RESEARCHING']);
    expect(code).toBe(2);
  });

  it('exits 2 for an unknown option instead of crashing past our exit-code contract', () => {
    const { code } = run(['product-transition', '--from', 'DISCOVERED', '--to', 'RESEARCHING', '--not-a-real-flag']);
    expect(code).toBe(2);
  });
});

describe('appforge security permissions (nested subcommand wiring)', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-security-binary-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('exits 0 for a matching manifest and permissions.yaml with no high-risk permissions', () => {
    const manifest = path.join(dir, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ permissions: ['storage'] }));
    const permissions = path.join(dir, 'permissions.yaml');
    writeFileSync(permissions, [
      'schema: appforge/permissions@1',
      'permissions:',
      '  - permission: storage',
      '    required: true',
      '    reason: "Persist settings locally"',
      '    data_access: [user_content_local]',
      '    security_impact: low',
    ].join('\n'));
    const { code } = run(['security', 'permissions', '--manifest', manifest, '--permissions', permissions]);
    expect(code).toBe(0);
  });

  it('exits 6, via the real nested "security permissions" subcommand, for an undocumented permission', () => {
    const manifest = path.join(dir, 'manifest-bad.json');
    writeFileSync(manifest, JSON.stringify({ permissions: ['storage', 'tabs'] }));
    const permissions = path.join(dir, 'permissions-bad.yaml');
    writeFileSync(permissions, [
      'schema: appforge/permissions@1',
      'permissions:',
      '  - permission: storage',
      '    required: true',
      '    reason: "Persist settings locally"',
      '    data_access: [user_content_local]',
      '    security_impact: low',
    ].join('\n'));
    const { code } = run(['security', 'permissions', '--manifest', manifest, '--permissions', permissions]);
    expect(code).toBe(6);
  });
});

describe('appforge security csp (nested subcommand wiring)', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-csp-binary-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('exits 0 for a manifest with a strict CSP', () => {
    const manifest = path.join(dir, 'manifest-ok.json');
    writeFileSync(manifest, JSON.stringify({ content_security_policy: { extension_pages: "script-src 'self'" } }));
    const { code } = run(['security', 'csp', '--manifest', manifest]);
    expect(code).toBe(0);
  });

  it('exits 7, via the real nested "security csp" subcommand, for unsafe-eval', () => {
    const manifest = path.join(dir, 'manifest-bad.json');
    writeFileSync(manifest, JSON.stringify({ content_security_policy: { extension_pages: "script-src 'unsafe-eval'" } }));
    const { code } = run(['security', 'csp', '--manifest', manifest]);
    expect(code).toBe(7);
  });
});

describe('appforge security bundle-size (nested subcommand wiring)', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-bundle-size-binary-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('exits 0 when under budget', () => {
    const distDir = path.join(dir, 'under');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, 'index.js'), 'a'.repeat(10));
    const { code } = run(['security', 'bundle-size', '--dist', distDir, '--max-kb', '1']);
    expect(code).toBe(0);
  });

  it('exits 9, via the real nested "security bundle-size" subcommand, when over budget', () => {
    const distDir = path.join(dir, 'over');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, 'index.js'), 'a'.repeat(2000));
    const { code } = run(['security', 'bundle-size', '--dist', distDir, '--max-kb', '1']);
    expect(code).toBe(9);
  });
});
