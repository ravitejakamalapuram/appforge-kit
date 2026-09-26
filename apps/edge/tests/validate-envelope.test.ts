import { describe, it, expect } from 'vitest';
import { validateEnvelope } from '../src/validate-envelope.js';

const VALID = {
  v: 1, product: 'json-workbench', app_version: '0.2.0', env: 'dev',
  install_id: 'install-1', session_id: 'session-1', ts: 1_700_000_000_000,
  event: 'feature_used', props: { feature: 'pipeline_run' }, seq: 0,
};

describe('validateEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(validateEnvelope(VALID)).toEqual(VALID);
  });

  it('defaults props to {} when missing', () => {
    const { props, ...rest } = VALID;
    expect(validateEnvelope(rest)?.props).toEqual({});
  });

  it('rejects a non-object input', () => {
    expect(validateEnvelope('nope')).toBeNull();
    expect(validateEnvelope(null)).toBeNull();
  });

  it('rejects a missing or empty install_id', () => {
    expect(validateEnvelope({ ...VALID, install_id: '' })).toBeNull();
    const { install_id, ...rest } = VALID;
    expect(validateEnvelope(rest)).toBeNull();
  });

  it('rejects a non-integer or negative seq', () => {
    expect(validateEnvelope({ ...VALID, seq: 1.5 })).toBeNull();
    expect(validateEnvelope({ ...VALID, seq: -1 })).toBeNull();
  });
});
