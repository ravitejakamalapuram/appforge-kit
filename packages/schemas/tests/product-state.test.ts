import { describe, it, expect } from 'vitest';
import { canTransition } from '../src/index.js';

describe('canTransition', () => {
  it('allows DISCOVERED -> RESEARCHING with all required evidence present', () => {
    const result = canTransition('DISCOVERED', 'RESEARCHING', {
      opportunityId: 'OPP-0001', problem: 'x', targetUser: 'y', sources: ['a'],
    }, false);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reports exactly which evidence keys are missing', () => {
    const result = canTransition('DISCOVERED', 'RESEARCHING', { opportunityId: 'OPP-0001' }, false);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(['problem', 'targetUser', 'sources']));
  });

  it('treats an empty-array or empty-string evidence value as missing (Review Focus)', () => {
    const result = canTransition('DISCOVERED', 'RESEARCHING', {
      opportunityId: 'OPP-0001', problem: '', targetUser: 'y', sources: [],
    }, false);
    expect(result.missing).toEqual(expect.arrayContaining(['problem', 'sources']));
  });

  it('rejects a transition with no defined edge, e.g. skipping straight to PRODUCTION (Review Focus)', () => {
    const result = canTransition('DISCOVERED', 'PRODUCTION', {}, true);
    expect(result.ok).toBe(false);
    expect(result.missing[0]).toMatch(/no transition defined/);
  });

  it('requires a verified approval for VALIDATING -> APPROVED even with full evidence', () => {
    const evidence = { scoreSheet: {}, evidenceSources: ['a', 'b', 'c'], mvpScope: '2 weeks', slotPlan: 'free slot' };
    const withoutApproval = canTransition('VALIDATING', 'APPROVED', evidence, false);
    expect(withoutApproval.ok).toBe(false);
    expect(withoutApproval.missing).toContain('approval');

    const withApproval = canTransition('VALIDATING', 'APPROVED', evidence, true);
    expect(withApproval.ok).toBe(true);
  });

  it('allows a transition that needs no evidence and no approval, e.g. APPROVED -> DESIGNING', () => {
    expect(canTransition('APPROVED', 'DESIGNING', {}, false).ok).toBe(true);
  });
});
