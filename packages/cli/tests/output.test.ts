import { describe, it, expect } from 'vitest';
import { buildOutput } from '../src/output.js';

describe('buildOutput (cli-output@1 contract)', () => {
  it('includes the schema tag and command name on success', () => {
    const out = buildOutput('validate', true, { checked: 1 });
    expect(out).toEqual({ schema: 'cli-output@1', ok: true, command: 'validate', data: { checked: 1 }, errors: [] });
  });

  it('carries errors on failure with no data field required', () => {
    const out = buildOutput('validate', false, undefined, ['(root): must have required property schema']);
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual(['(root): must have required property schema']);
  });
});
