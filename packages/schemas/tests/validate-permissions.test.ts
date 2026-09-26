import { describe, it, expect } from 'vitest';
import { validatePermissions } from '../src/index.js';

const validDoc = {
  schema: 'appforge/permissions@1',
  permissions: [
    { permission: 'storage', required: true, reason: "Save the user's pipelines locally", data_access: ['user_content_local'], security_impact: 'low' },
  ],
};

describe('validatePermissions', () => {
  it('accepts a valid document', () => {
    expect(validatePermissions(validDoc)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a document missing the schema field', () => {
    const { schema, ...rest } = validDoc;
    const result = validatePermissions(rest);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a permission entry with an empty reason', () => {
    const doc = { ...validDoc, permissions: [{ ...validDoc.permissions[0], reason: '' }] };
    expect(validatePermissions(doc).ok).toBe(false);
  });

  it('rejects an invalid security_impact value', () => {
    const doc = { ...validDoc, permissions: [{ ...validDoc.permissions[0], security_impact: 'extreme' }] };
    expect(validatePermissions(doc).ok).toBe(false);
  });

  it('rejects a malformed top-level value (Review Focus: garbage input, not just missing fields)', () => {
    expect(validatePermissions('not an object').ok).toBe(false);
    expect(validatePermissions(null).ok).toBe(false);
    expect(validatePermissions(undefined).ok).toBe(false);
  });
});
