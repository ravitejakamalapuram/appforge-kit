import type { Complexity, ModelRef, TierConfig } from './types.js';

const TIER_KEYS: readonly Complexity[] = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];

/** One tier entry as it appears in models.yaml (snake_case, matching §29f's example). */
export interface ModelsYamlTier {
  provider?: string;
  model?: string;
  fallback?: ModelRef;
  independent_review?: ModelRef;
  /** e.g. CRITICAL: { inherit: HIGH, independent_review: {...} } — reuses HIGH's provider/model/limits. */
  inherit?: Complexity;
  max_tokens?: number;
  timeout_s?: number;
}

export interface ModelsYamlDoc {
  tiers: Partial<Record<Complexity, ModelsYamlTier>>;
  deterministic_tasks?: string[];
}

function pick<T>(raw: T | undefined, base: T | undefined, field: string, tier: Complexity): T {
  const value = raw ?? base;
  if (value === undefined) {
    throw new Error(`models.yaml tier "${tier}" is missing "${field}" (and no inherited tier provides it)`);
  }
  return value;
}

/**
 * Turns a parsed models.yaml document into the `RouterConfig.tiers` shape the router needs:
 * resolves `inherit` (a tier reusing another tier's provider/model/limits while keeping its own
 * `independent_review`), and converts snake_case YAML fields to the camelCase TierConfig shape.
 * Takes an already-parsed document (no file I/O here) to keep the router package pure.
 */
export function loadTierConfigs(doc: ModelsYamlDoc): Record<Complexity, TierConfig> {
  const resolved: Partial<Record<Complexity, TierConfig>> = {};

  for (const tier of TIER_KEYS) {
    const raw = doc.tiers[tier];
    if (!raw) {
      throw new Error(`models.yaml is missing tier "${tier}"`);
    }

    let base: ModelsYamlTier | undefined;
    if (raw.inherit) {
      base = doc.tiers[raw.inherit];
      if (!base) {
        throw new Error(`models.yaml tier "${tier}" inherits from unknown tier "${raw.inherit}"`);
      }
    }

    const provider = pick(raw.provider, base?.provider, 'provider', tier);
    const model = pick(raw.model, base?.model, 'model', tier);
    const maxTokens = pick(raw.max_tokens, base?.max_tokens, 'max_tokens', tier);
    const timeoutSec = pick(raw.timeout_s, base?.timeout_s, 'timeout_s', tier);
    const fallback = raw.fallback ?? base?.fallback;
    const independentReview = raw.independent_review ?? base?.independent_review;

    const tierConfig: TierConfig = { provider, model, maxTokens, timeoutSec };
    if (fallback) tierConfig.fallback = fallback;
    if (independentReview) tierConfig.independentReview = independentReview;
    resolved[tier] = tierConfig;
  }

  return resolved as Record<Complexity, TierConfig>;
}

/** Extracts the deterministic-task-type list from a parsed models.yaml document, or []. */
export function loadDeterministicTaskTypes(doc: Pick<ModelsYamlDoc, 'deterministic_tasks'>): string[] {
  return doc.deterministic_tasks ?? [];
}
