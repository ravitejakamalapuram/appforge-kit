import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { loadTierConfigs, loadDeterministicTaskTypes, TieredModelRouter } from '../src/index.js';

const MODELS_YAML = `
tiers:
  LOW:      { provider: anthropic, model: "claude-haiku-x", fallback: { provider: openai, model: "gpt-small-x" }, max_tokens: 4000,  timeout_s: 300 }
  NORMAL:   { provider: anthropic, model: "claude-sonnet-x", fallback: { provider: openai, model: "gpt-workhorse-x" }, max_tokens: 16000, timeout_s: 1800 }
  HIGH:     { provider: anthropic, model: "claude-opus-x", fallback: { provider: openai, model: "gpt-top-x" }, max_tokens: 32000, timeout_s: 3600 }
  CRITICAL: { inherit: HIGH, independent_review: { provider: openai, model: "gpt-top-x" } }
deterministic_tasks: [json_validation, schema_validation, lint, format, version_compare, pnl_math, ci_check, permission_diff, dependency_scan]
`;

describe('loadTierConfigs', () => {
  it('loads all four tiers with camelCase fields from the snake_case YAML shape', () => {
    const doc = parseYaml(MODELS_YAML);
    const tiers = loadTierConfigs(doc);
    expect(tiers.LOW).toEqual({
      provider: 'anthropic', model: 'claude-haiku-x',
      fallback: { provider: 'openai', model: 'gpt-small-x' },
      maxTokens: 4000, timeoutSec: 300,
    });
  });

  it('resolves CRITICAL.inherit: HIGH to HIGH\'s provider/model, while keeping CRITICAL\'s own independent_review', () => {
    const doc = parseYaml(MODELS_YAML);
    const tiers = loadTierConfigs(doc);
    expect(tiers.CRITICAL.provider).toBe('anthropic');
    expect(tiers.CRITICAL.model).toBe('claude-opus-x');
    expect(tiers.CRITICAL.maxTokens).toBe(32000);
    expect(tiers.CRITICAL.independentReview).toEqual({ provider: 'openai', model: 'gpt-top-x' });
  });

  it('the loaded config feeds TieredModelRouter.select end to end', () => {
    const doc = parseYaml(MODELS_YAML);
    const tiers = loadTierConfigs(doc);
    const router = new TieredModelRouter({
      tiers,
      deterministicTaskTypes: loadDeterministicTaskTypes(doc),
      codeTaskTypes: ['implement_feature'],
      agentForTier: { LOW: 'builder', NORMAL: 'builder', HIGH: 'builder-high', CRITICAL: 'builder-high' },
    });
    const decision = router.select({ taskType: 'implement_feature', complexity: 'NORMAL', risk: 'low', budgetRemainingPct: 1, latency: 'interactive' });
    expect(decision.model).toBe('claude-sonnet-x');
  });

  it('throws a clear error when a tier is missing entirely from the document', () => {
    const doc = { tiers: { LOW: { provider: 'a', model: 'b', max_tokens: 1, timeout_s: 1 } } };
    expect(() => loadTierConfigs(doc)).toThrow(/missing tier "NORMAL"/);
  });

  it('throws a clear error when inherit points at a tier that does not exist', () => {
    const doc = {
      tiers: {
        LOW: { provider: 'a', model: 'b', max_tokens: 1, timeout_s: 1 },
        NORMAL: { provider: 'a', model: 'b', max_tokens: 1, timeout_s: 1 },
        HIGH: { provider: 'a', model: 'b', max_tokens: 1, timeout_s: 1 },
        CRITICAL: { inherit: 'ULTRA' },
      },
    };
    expect(() => loadTierConfigs(doc)).toThrow(/unknown tier "ULTRA"/);
  });

  it('throws a clear error when provider/model is missing on both the tier and anything it inherits from', () => {
    const doc = {
      tiers: {
        LOW: { provider: 'a', model: 'b', max_tokens: 1, timeout_s: 1 },
        NORMAL: { max_tokens: 1, timeout_s: 1 },
        HIGH: { provider: 'a', model: 'b', max_tokens: 1, timeout_s: 1 },
        CRITICAL: { provider: 'a', model: 'b', max_tokens: 1, timeout_s: 1 },
      },
    };
    expect(() => loadTierConfigs(doc)).toThrow(/missing "provider"/);
  });
});

describe('loadDeterministicTaskTypes', () => {
  it('returns the configured list', () => {
    const doc = parseYaml(MODELS_YAML);
    expect(loadDeterministicTaskTypes(doc)).toEqual([
      'json_validation', 'schema_validation', 'lint', 'format', 'version_compare',
      'pnl_math', 'ci_check', 'permission_diff', 'dependency_scan',
    ]);
  });

  it('returns an empty array when the field is absent', () => {
    expect(loadDeterministicTaskTypes({ tiers: {} })).toEqual([]);
  });
});
