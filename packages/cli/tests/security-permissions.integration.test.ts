import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSecurityPermissions } from '../src/commands/security-permissions.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-security-test-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function write(name: string, content: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

const VALID_PERMISSIONS_YAML = [
  'schema: appforge/permissions@1',
  'permissions:',
  '  - permission: storage',
  '    required: true',
  "    reason: \"Persist user settings locally\"",
  '    data_access: [user_content_local]',
  '    security_impact: low',
].join('\n');

describe('runSecurityPermissions', () => {
  it('returns 0 when the manifest matches permissions.yaml exactly with no high-risk permissions', () => {
    const manifest = write('manifest-ok.json', JSON.stringify({ permissions: ['storage'] }));
    const permissions = write('permissions-ok.yaml', VALID_PERMISSIONS_YAML);
    expect(runSecurityPermissions({ manifestFile: manifest, permissionsFile: permissions, json: true })).toBe(0);
  });

  it('returns 6 when the manifest requests a permission not documented in permissions.yaml', () => {
    const manifest = write('manifest-undoc.json', JSON.stringify({ permissions: ['storage', 'tabs'] }));
    const permissions = write('permissions-undoc.yaml', VALID_PERMISSIONS_YAML);
    expect(runSecurityPermissions({ manifestFile: manifest, permissionsFile: permissions, json: true })).toBe(6);
  });

  it('returns 6 for a high-risk permission using the built-in default list when no --security file is given', () => {
    const manifest = write('manifest-highrisk.json', JSON.stringify({ permissions: ['storage', 'cookies'] }));
    const permissions = write('permissions-highrisk.yaml', [
      VALID_PERMISSIONS_YAML,
      '  - permission: cookies',
      '    required: true',
      '    reason: "Read auth cookies"',
      '    data_access: [cookies]',
      '    security_impact: high',
    ].join('\n'));
    expect(runSecurityPermissions({ manifestFile: manifest, permissionsFile: permissions, json: true })).toBe(6);
  });

  it('does not flag a high-risk permission as newly added when a --previous-manifest already had it', () => {
    const previous = write('manifest-prev.json', JSON.stringify({ permissions: ['storage', 'cookies'] }));
    const manifest = write('manifest-current.json', JSON.stringify({ permissions: ['storage', 'cookies'] }));
    const permissions = write('permissions-prev.yaml', [
      VALID_PERMISSIONS_YAML,
      '  - permission: cookies',
      '    required: true',
      '    reason: "Read auth cookies"',
      '    data_access: [cookies]',
      '    security_impact: high',
    ].join('\n'));
    expect(runSecurityPermissions({ manifestFile: manifest, permissionsFile: permissions, previousManifestFile: previous, json: true })).toBe(0);
  });

  it('returns 2 for an unreadable manifest file, not a crash', () => {
    const permissions = write('permissions-for-missing-manifest.yaml', VALID_PERMISSIONS_YAML);
    expect(runSecurityPermissions({ manifestFile: path.join(dir, 'does-not-exist.json'), permissionsFile: permissions, json: true })).toBe(2);
  });

  it('returns 2 when permissions.yaml fails its own schema validation', () => {
    const manifest = write('manifest-for-bad-yaml.json', JSON.stringify({ permissions: ['storage'] }));
    const permissions = write('permissions-bad.yaml', 'schema: appforge/permissions@1\npermissions: []\nextra: nope');
    expect(runSecurityPermissions({ manifestFile: manifest, permissionsFile: permissions, json: true })).toBe(2);
  });

  it('uses a custom --security file high_risk_permissions list instead of the built-in default', () => {
    // "tabs" is not on the built-in default high-risk list, but a custom security.yaml can add it.
    const manifest = write('manifest-custom-risk.json', JSON.stringify({ permissions: ['storage', 'tabs'] }));
    const permissions = write('permissions-custom-risk.yaml', [
      VALID_PERMISSIONS_YAML,
      '  - permission: tabs',
      '    required: true',
      '    reason: "Read the active tab URL"',
      '    data_access: [tab_url]',
      '    security_impact: medium',
    ].join('\n'));
    const security = write('security-custom.yaml', 'high_risk_permissions: [tabs]');
    expect(runSecurityPermissions({ manifestFile: manifest, permissionsFile: permissions, securityFile: security, json: true })).toBe(6);
  });
});
