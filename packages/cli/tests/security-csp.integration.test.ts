import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSecurityCsp } from '../src/commands/security-csp.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-security-csp-test-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function write(name: string, content: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('runSecurityCsp', () => {
  it('returns 0 for a manifest with a strict CSP and no remote scripts', () => {
    const manifest = write('manifest-ok.json', JSON.stringify({
      background: { service_worker: 'service-worker-loader.js' },
      content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
    }));
    expect(runSecurityCsp({ manifestFile: manifest, json: true })).toBe(0);
  });

  it('returns 7 for a manifest allowing unsafe-eval', () => {
    const manifest = write('manifest-unsafe-eval.json', JSON.stringify({
      content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval'" },
    }));
    expect(runSecurityCsp({ manifestFile: manifest, json: true })).toBe(7);
  });

  it('returns 7 for a manifest with a remote content_scripts[].js entry', () => {
    const manifest = write('manifest-remote-script.json', JSON.stringify({
      content_scripts: [{ matches: ['<all_urls>'], js: ['https://evil.example.com/inject.js'] }],
    }));
    expect(runSecurityCsp({ manifestFile: manifest, json: true })).toBe(7);
  });

  it('returns 2 for an unreadable manifest file, not a crash', () => {
    expect(runSecurityCsp({ manifestFile: path.join(dir, 'does-not-exist.json'), json: true })).toBe(2);
  });

  it('returns 2 for a manifest file that is not valid JSON', () => {
    const manifest = write('manifest-broken.json', '{not json');
    expect(runSecurityCsp({ manifestFile: manifest, json: true })).toBe(2);
  });
});
