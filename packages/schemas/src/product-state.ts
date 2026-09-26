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
  { from: 'VALIDATING', to: 'APPROVED', requiredEvidence: ['scoreSheet', 'evidenceSources', 'mvpScope', 'slotPlan'], requiresApproval: true },
  { from: 'APPROVED', to: 'DESIGNING', requiredEvidence: [], requiresApproval: false },
  { from: 'DESIGNING', to: 'BUILDING', requiredEvidence: ['prd', 'architecture', 'permissionsYaml', 'dataClassification', 'acceptanceCriteria'], requiresApproval: false },
  { from: 'BUILDING', to: 'TESTING', requiredEvidence: ['ciGreen'], requiresApproval: false },
  { from: 'TESTING', to: 'SECURITY_REVIEW', requiredEvidence: ['qaEvidenceComplete'], requiresApproval: false },
  { from: 'SECURITY_REVIEW', to: 'RELEASE_CANDIDATE', requiredEvidence: ['securityScanClean'], requiresApproval: false },
  { from: 'RELEASE_CANDIDATE', to: 'HUMAN_APPROVAL', requiredEvidence: ['rcChecklist', 'storeListingDiff', 'privacyDiff', 'changelog'], requiresApproval: false },
  { from: 'HUMAN_APPROVAL', to: 'BETA', requiredEvidence: ['approvalId'], requiresApproval: true },
  { from: 'HUMAN_APPROVAL', to: 'PRODUCTION', requiredEvidence: ['approvalId'], requiresApproval: true },
  { from: 'BETA', to: 'PRODUCTION', requiredEvidence: ['betaMetricsOk'], requiresApproval: false },
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

export interface TransitionCheckResult {
  ok: boolean;
  missing: string[];
  rule?: TransitionRule;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
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
