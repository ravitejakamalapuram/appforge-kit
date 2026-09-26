import type { Complexity, ModelRouter, RouteDecision, RouteRequest, RouterConfig } from './types.js';

const TIER_ORDER: readonly Complexity[] = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const BUDGET_DOWNGRADE_THRESHOLD_PCT = 0.2;

export class UseScriptError extends Error {
  constructor(public readonly taskType: string) {
    super(`Task type "${taskType}" is deterministic and must run as a script, not an LLM call.`);
    this.name = 'UseScriptError';
  }
}

function reasoningLevelFor(tier: Complexity): 'low' | 'medium' | 'high' {
  if (tier === 'LOW') return 'low';
  if (tier === 'NORMAL') return 'medium';
  return 'high';
}

export class TieredModelRouter implements ModelRouter {
  constructor(private readonly config: RouterConfig) {}

  select(request: RouteRequest): RouteDecision {
    if (this.config.deterministicTaskTypes.includes(request.taskType)) {
      throw new UseScriptError(request.taskType);
    }

    let tierIndex = TIER_ORDER.indexOf(request.complexity);
    if (tierIndex === -1) {
      throw new Error(`Unknown complexity tier: "${request.complexity}"`);
    }

    const highIndex = TIER_ORDER.indexOf('HIGH');
    const criticalIndex = TIER_ORDER.indexOf('CRITICAL');
    const riskFloorIndex = request.risk === 'high' ? highIndex : 0;

    if (request.risk === 'high') {
      tierIndex = Math.max(tierIndex, highIndex);
    }

    // Budget pressure never downgrades CRITICAL (that tier exists precisely for stakes cost
    // must not override — §7.1) and never drops a high-risk request below its risk floor
    // (§7.2: "risk:high ⇒ tier ≥ HIGH" must hold even under budget pressure).
    if (request.budgetRemainingPct < BUDGET_DOWNGRADE_THRESHOLD_PCT && tierIndex < criticalIndex) {
      const isCodeTask = this.config.codeTaskTypes.includes(request.taskType);
      const codeFloorIndex = isCodeTask ? TIER_ORDER.indexOf('NORMAL') : 0;
      const floorIndex = Math.max(codeFloorIndex, riskFloorIndex);
      tierIndex = Math.max(floorIndex, tierIndex - 1);
    }

    const tier = TIER_ORDER[tierIndex];
    const tierConfig = this.config.tiers[tier];

    const decision: RouteDecision = {
      provider: tierConfig.provider,
      model: tierConfig.model,
      reasoningLevel: reasoningLevelFor(tier),
      maxOutputTokens: tierConfig.maxTokens,
      timeoutSec: tierConfig.timeoutSec,
      adapterAgent: this.config.agentForTier[tier],
    };
    if (tierConfig.fallback) decision.fallback = tierConfig.fallback;

    if (tier === 'CRITICAL') {
      if (!tierConfig.independentReview) {
        throw new Error('CRITICAL tier is missing an independentReview entry in RouterConfig — refusing to route silently.');
      }
      decision.independentReview = tierConfig.independentReview;
    }

    return decision;
  }
}
