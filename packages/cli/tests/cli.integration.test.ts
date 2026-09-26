import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runValidate } from '../src/commands/validate.js';
import { runProductTransition } from '../src/commands/product-transition.js';
import type { ProductState } from '@appforge/schemas';

let dir: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'appforge-cli-test-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('runValidate', () => {
  it('returns 0 for a valid permissions.yaml', () => {
    const file = path.join(dir, 'valid.yaml');
    writeFileSync(file, [
      'schema: appforge/permissions@1',
      'permissions:',
      '  - permission: storage',
      '    required: true',
      "    reason: \"Save the user's pipelines locally\"",
      '    data_access: [user_content_local]',
      '    security_impact: low',
    ].join('\n'));
    expect(runValidate({ file, json: true })).toBe(0);
  });

  it('returns 2 for malformed YAML, not a crash (Review Focus)', () => {
    const file = path.join(dir, 'broken.yaml');
    writeFileSync(file, 'schema: [unclosed');
    expect(runValidate({ file, json: true })).toBe(2);
  });

  it('returns 3 for well-formed YAML that fails the schema', () => {
    const file = path.join(dir, 'invalid.yaml');
    writeFileSync(file, 'schema: appforge/permissions@1\npermissions: []\nextra: not-allowed');
    expect(runValidate({ file, json: true })).toBe(3);
  });
});

describe('runProductTransition', () => {
  it('returns 8 for a transition with no defined edge (Review Focus)', () => {
    expect(runProductTransition({ from: 'DISCOVERED', to: 'PRODUCTION', approved: true, json: true })).toBe(8);
  });

  it('returns 0 for an allowed transition with an evidence file', () => {
    const file = path.join(dir, 'evidence.json');
    writeFileSync(file, JSON.stringify({ opportunityId: 'OPP-0001', problem: 'x', targetUser: 'y', sources: ['a'] }));
    expect(runProductTransition({ from: 'DISCOVERED', to: 'RESEARCHING', evidenceFile: file, approved: false, json: true })).toBe(0);
  });

  it('returns 2 when the evidence file contains JSON null, not a crash (Review Focus)', () => {
    const file = path.join(dir, 'null-evidence.json');
    writeFileSync(file, 'null');
    expect(runProductTransition({ from: 'DISCOVERED', to: 'RESEARCHING', evidenceFile: file, approved: false, json: true })).toBe(2);
  });

  it('returns 2 when the evidence file contains a JSON array, not an object', () => {
    const file = path.join(dir, 'array-evidence.json');
    writeFileSync(file, '[]');
    expect(runProductTransition({ from: 'DISCOVERED', to: 'RESEARCHING', evidenceFile: file, approved: false, json: true })).toBe(2);
  });

  it('returns 2 for an invalid --from state that is not a real ProductState (fix: runtime-validate, not just via types)', () => {
    expect(runProductTransition({ from: 'NOT_A_STATE' as ProductState, to: 'RESEARCHING', approved: false, json: true })).toBe(2);
  });
});
