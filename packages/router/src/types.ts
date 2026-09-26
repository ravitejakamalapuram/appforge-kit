export type Complexity = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

/** Deliberately an open string, not a closed union — see Global Constraints. */
export type TaskType = string;

export interface RouteRequest {
  taskType: TaskType;
  complexity: Complexity;
  risk: 'low' | 'med' | 'high';
  /** 0–1 fraction: remaining budget ÷ this agent's monthly budget. */
  budgetRemainingPct: number;
  latency: 'interactive' | 'batch';
}

export interface ModelRef {
  provider: string;
  model: string;
}

export interface RouteDecision {
  provider: string;
  model: string;
  reasoningLevel: 'low' | 'medium' | 'high';
  maxOutputTokens: number;
  timeoutSec: number;
  fallback?: ModelRef;
  independentReview?: ModelRef;
  adapterAgent: string;
}

export interface TierConfig extends ModelRef {
  fallback?: ModelRef;
  independentReview?: ModelRef;
  maxTokens: number;
  timeoutSec: number;
}

export interface RouterConfig {
  tiers: Record<Complexity, TierConfig>;
  deterministicTaskTypes: readonly string[];
  codeTaskTypes: readonly string[];
  agentForTier: Record<Complexity, string>;
}

export interface ModelRouter {
  select(request: RouteRequest): RouteDecision;
}
