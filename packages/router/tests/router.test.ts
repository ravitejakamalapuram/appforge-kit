import { describe, it, expect } from 'vitest';
import { TieredModelRouter, UseScriptError, RouterConfig, Complexity } from '../src/index.js';

const baseConfig: RouterConfig = {
  tiers: {
    LOW: { provider: 'anthropic', model: 'claude-haiku-x', maxTokens: 4000, timeoutSec: 300 },
    NORMAL: { provider: 'anthropic', model: 'claude-sonnet-x', maxTokens: 16000, timeoutSec: 1800 },
    HIGH: { provider: 'anthropic', model: 'claude-opus-x', maxTokens: 32000, timeoutSec: 3600 },
    CRITICAL: {
      provider: 'anthropic', model: 'claude-opus-x', maxTokens: 32000, timeoutSec: 3600,
      independentReview: { provider: 'openai', model: 'gpt-top-x' },
    },
  },
  deterministicTaskTypes: ['schema_validation', 'lint', 'permission_diff'],
  codeTaskTypes: ['implement_feature', 'fix_bug'],
  agentForTier: { LOW: 'builder', NORMAL: 'builder', HIGH: 'builder-high', CRITICAL: 'builder-high' },
};

describe('TieredModelRouter.select — deterministic task guard', () => {
  it('throws UseScriptError for a deterministic task type', () => {
    const router = new TieredModelRouter(baseConfig);
    expect(() =>
      router.select({ taskType: 'schema_validation', complexity: 'LOW', risk: 'low', budgetRemainingPct: 1, latency: 'batch' })
    ).toThrow(UseScriptError);
  });
});

describe('TieredModelRouter.select — tier selection rules', () => {
  it('routes a LOW/low-risk/full-budget request to the LOW tier', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'write_prd', complexity: 'LOW', risk: 'low', budgetRemainingPct: 1, latency: 'batch' });
    expect(decision.model).toBe('claude-haiku-x');
    expect(decision.adapterAgent).toBe('builder');
    expect(decision.independentReview).toBeUndefined();
  });

  it('bumps a NORMAL/high-risk request up to HIGH', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'implement_feature', complexity: 'NORMAL', risk: 'high', budgetRemainingPct: 1, latency: 'interactive' });
    expect(decision.model).toBe('claude-opus-x');
    expect(decision.adapterAgent).toBe('builder-high');
  });

  it('downgrades a HIGH code task to NORMAL (not lower) when budget is low', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'implement_feature', complexity: 'HIGH', risk: 'low', budgetRemainingPct: 0.1, latency: 'interactive' });
    expect(decision.model).toBe('claude-sonnet-x');
  });

  it('does not downgrade below LOW for a non-code task when budget is low', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'marketing_copy', complexity: 'LOW', risk: 'low', budgetRemainingPct: 0.05, latency: 'batch' });
    expect(decision.model).toBe('claude-haiku-x');
  });

  it('attaches independentReview for CRITICAL', () => {
    const router = new TieredModelRouter(baseConfig);
    const decision = router.select({ taskType: 'security_review', complexity: 'CRITICAL', risk: 'high', budgetRemainingPct: 1, latency: 'batch' });
    expect(decision.independentReview).toEqual({ provider: 'openai', model: 'gpt-top-x' });
  });

  it('fails loudly if CRITICAL config has no independentReview (Review Focus)', () => {
    const brokenConfig: RouterConfig = {
      ...baseConfig,
      tiers: { ...baseConfig.tiers, CRITICAL: { provider: 'anthropic', model: 'claude-opus-x', maxTokens: 32000, timeoutSec: 3600 } },
    };
    const router = new TieredModelRouter(brokenConfig);
    expect(() =>
      router.select({ taskType: 'security_review', complexity: 'CRITICAL', risk: 'high', budgetRemainingPct: 1, latency: 'batch' })
    ).toThrow(/independentReview/);
  });

  it('throws on an unrecognized complexity value from untyped input (Review Focus)', () => {
    const router = new TieredModelRouter(baseConfig);
    const bad = { taskType: 'write_prd', complexity: 'URGENT' as unknown as Complexity, risk: 'low', budgetRemainingPct: 1, latency: 'batch' } as const;
    expect(() => router.select(bad)).toThrow(/Unknown complexity/);
  });
});
