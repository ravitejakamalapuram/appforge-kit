/**
 * Per-product event/prop allowlist (master plan §29f analytics.yaml, §16.3 data classification).
 * Events or props not listed here are silently dropped, never written to D1 — see Review Focus.
 */
export interface ProductAllowlist {
  allowedEvents: ReadonlySet<string>;
  allowedProps: Readonly<Record<string, ReadonlySet<string>>>;
}

const PRODUCTS: Readonly<Record<string, ProductAllowlist>> = {
  'json-workbench': {
    allowedEvents: new Set([
      'app_installed',
      'app_updated',
      'onboarding_completed',
      'feature_used',
      'feature_failed',
      'review_prompt_shown',
      'crosspromo_clicked',
    ]),
    allowedProps: {
      feature_used: new Set(['feature', 'ok']),
    },
  },
};

export function getAllowlist(product: string): ProductAllowlist | undefined {
  return PRODUCTS[product];
}

const MAX_PROP_STRING_LENGTH = 500;

// A value not allowed here (nested objects/arrays, or a string over the length cap) is dropped
// like an undeclared key, not truncated or serialized — an unbounded or nested prop value could
// otherwise smuggle arbitrary blobs or PII into an "allowlisted" key (Review finding).
function isAllowedPropValue(value: unknown): boolean {
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value === 'string') return value.length <= MAX_PROP_STRING_LENGTH;
  return false;
}

export function filterProps(
  event: string,
  props: Record<string, unknown>,
  allowlist: ProductAllowlist
): Record<string, unknown> {
  const allowed = allowlist.allowedProps[event];
  if (!allowed) return {};
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (allowed.has(key) && isAllowedPropValue(value)) filtered[key] = value;
  }
  return filtered;
}
