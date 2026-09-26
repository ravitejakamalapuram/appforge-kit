export type ProductState =
  | 'DISCOVERED' | 'RESEARCHING' | 'VALIDATING' | 'APPROVED' | 'DESIGNING'
  | 'BUILDING' | 'TESTING' | 'SECURITY_REVIEW' | 'RELEASE_CANDIDATE'
  | 'HUMAN_APPROVAL' | 'BETA' | 'PRODUCTION' | 'GROWTH' | 'MAINTENANCE'
  | 'PAUSED' | 'SUNSET' | 'ARCHIVED';

export interface TransitionRule {
  from: ProductState;
  to: ProductState;
  requiredEvidence: readonly string[];
  requiresApproval: boolean;
}

export const TRANSITIONS: readonly TransitionRule[] = [
  { from: 'DISCOVERED', to: 'RESEARCHING', requiredEvidence: ['opportunityId', 'problem', 'targetUser', 'sources'], requiresApproval: false },
  { from: 'RESEARCHING', to: 'VALIDATING', requiredEvidence: ['disproofAnswers', 'competitorsChecked'], requiresApproval: false },
  { from: 'RESEARCHING', to: 'ARCHIVED', requiredEvidence: [], requiresApproval: false },
  { from: 'VALIDATING', to: 'APPROVED', requiredEvidence: ['scoreSheet', 'evidenceSources', 'mvpScope', 'slotPlan'], requiresApproval: true },
  { from: 'VALIDATING', to: 'ARCHIVED', requiredEvidence: [], requiresApproval: false },
  { from: 'APPROVED', to: 'DESIGNING', requiredEvidence: [], requiresApproval: false },
  { from: 'DESIGNING', to: 'BUILDING', requiredEvidence: ['prd', 'architecture', 'permissionsYaml', 'dataClassification', 'acceptanceCriteria'], requiresApproval: false },
  { from: 'BUILDING', to: 'TESTING', requiredEvidence: ['ciGreen'], requiresApproval: false },
  { from: 'TESTING', to: 'SECURITY_REVIEW', requiredEvidence: ['qaEvidenceComplete'], requiresApproval: false },
  { from: 'TESTING', to: 'BUILDING', requiredEvidence: [], requiresApproval: false },
  { from: 'SECURITY_REVIEW', to: 'RELEASE_CANDIDATE', requiredEvidence: ['securityScanClean'], requiresApproval: false },
  { from: 'SECURITY_REVIEW', to: 'BUILDING', requiredEvidence: [], requiresApproval: false },
  { from: 'RELEASE_CANDIDATE', to: 'HUMAN_APPROVAL', requiredEvidence: ['rcChecklist', 'storeListingDiff', 'privacyDiff', 'changelog'], requiresApproval: false },
  { from: 'HUMAN_APPROVAL', to: 'BETA', requiredEvidence: ['approvalId'], requiresApproval: true },
  { from: 'HUMAN_APPROVAL', to: 'PRODUCTION', requiredEvidence: ['approvalId'], requiresApproval: true },
  { from: 'HUMAN_APPROVAL', to: 'BUILDING', requiredEvidence: [], requiresApproval: false },
  { from: 'BETA', to: 'PRODUCTION', requiredEvidence: ['betaMetricsOk'], requiresApproval: true },
  { from: 'BETA', to: 'BUILDING', requiredEvidence: [], requiresApproval: false },
  { from: 'PRODUCTION', to: 'GROWTH', requiredEvidence: ['analystReadout'], requiresApproval: false },
  { from: 'PRODUCTION', to: 'MAINTENANCE', requiredEvidence: ['analystReadout'], requiresApproval: false },
  { from: 'GROWTH', to: 'MAINTENANCE', requiredEvidence: [], requiresApproval: false },
  { from: 'MAINTENANCE', to: 'GROWTH', requiredEvidence: [], requiresApproval: false },
  { from: 'GROWTH', to: 'PAUSED', requiredEvidence: ['killPolicySheet'], requiresApproval: true },
  { from: 'MAINTENANCE', to: 'PAUSED', requiredEvidence: ['killPolicySheet'], requiresApproval: true },
  { from: 'PAUSED', to: 'MAINTENANCE', requiredEvidence: [], requiresApproval: false },
  { from: 'PAUSED', to: 'SUNSET', requiredEvidence: ['killPolicySheet'], requiresApproval: true },
  { from: 'SUNSET', to: 'ARCHIVED', requiredEvidence: [], requiresApproval: false },
];

/** All valid ProductState values, in state-machine order, for runtime validation of untyped input. */
export const PRODUCT_STATES: readonly ProductState[] = [
  'DISCOVERED', 'RESEARCHING', 'VALIDATING', 'APPROVED', 'DESIGNING',
  'BUILDING', 'TESTING', 'SECURITY_REVIEW', 'RELEASE_CANDIDATE',
  'HUMAN_APPROVAL', 'BETA', 'PRODUCTION', 'GROWTH', 'MAINTENANCE',
  'PAUSED', 'SUNSET', 'ARCHIVED',
];

export interface TransitionCheckResult {
  ok: boolean;
  missing: string[];
  rule?: TransitionRule;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  // A boolean flag (e.g. ciGreen, qaEvidenceComplete) must be strictly true — `false` records
  // that the underlying check failed and must not satisfy the gate it names.
  if (typeof value === 'boolean') return value === true;
  if (typeof value === 'string') return value.trim().length > 0;
  // An array is present only if it has at least one genuinely present element — an array of
  // blank placeholders (e.g. evidenceSources: ['']) must not satisfy the gate either.
  if (Array.isArray(value)) return value.some((item) => isPresent(item));
  // A plain object (e.g. scoreSheet: {}) with no keys is a placeholder, not evidence.
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

export function canTransition(
  from: ProductState,
  to: ProductState,
  evidence: Record<string, unknown>,
  hasApproval: boolean
): TransitionCheckResult {
  const rule = TRANSITIONS.find((r) => r.from === from && r.to === to);
  if (!rule) {
    return { ok: false, missing: [`no transition defined from ${from} to ${to}`] };
  }
  const missing = rule.requiredEvidence.filter((key) => !isPresent(evidence[key]));
  if (rule.requiresApproval && !hasApproval) missing.push('approval');
  return { ok: missing.length === 0, missing, rule };
}
