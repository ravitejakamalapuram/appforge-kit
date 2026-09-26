export interface ValidEnvelope {
  v: 1;
  product: string;
  app_version: string;
  env: string;
  install_id: string;
  session_id: string;
  ts: number;
  event: string;
  props: Record<string, unknown>;
  seq: number;
}

const MAX_SHORT_FIELD_LENGTH = 64;
const MAX_ID_FIELD_LENGTH = 128;
const VALID_ENVS = new Set(['dev', 'staging', 'prod']);

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function validateEnvelope(input: unknown): ValidEnvelope | null {
  if (typeof input !== 'object' || input === null) return null;
  const e = input as Record<string, unknown>;
  if (e.v !== 1) return null;
  if (!isBoundedString(e.product, MAX_SHORT_FIELD_LENGTH)) return null;
  if (typeof e.app_version !== 'string' || e.app_version.length > MAX_SHORT_FIELD_LENGTH) return null;
  if (typeof e.env !== 'string' || !VALID_ENVS.has(e.env)) return null;
  if (!isBoundedString(e.install_id, MAX_ID_FIELD_LENGTH)) return null;
  if (typeof e.session_id !== 'string' || e.session_id.length > MAX_ID_FIELD_LENGTH) return null;
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return null;
  if (!isBoundedString(e.event, MAX_SHORT_FIELD_LENGTH)) return null;
  if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq < 0) return null;
  const props = typeof e.props === 'object' && e.props !== null ? (e.props as Record<string, unknown>) : {};
  return {
    v: 1,
    product: e.product,
    app_version: e.app_version,
    env: e.env,
    install_id: e.install_id,
    session_id: e.session_id,
    ts: e.ts,
    event: e.event,
    props,
    seq: e.seq,
  };
}
