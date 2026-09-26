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

export function validateEnvelope(input: unknown): ValidEnvelope | null {
  if (typeof input !== 'object' || input === null) return null;
  const e = input as Record<string, unknown>;
  if (e.v !== 1) return null;
  if (typeof e.product !== 'string' || e.product.length === 0) return null;
  if (typeof e.app_version !== 'string') return null;
  if (typeof e.env !== 'string') return null;
  if (typeof e.install_id !== 'string' || e.install_id.length === 0) return null;
  if (typeof e.session_id !== 'string') return null;
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return null;
  if (typeof e.event !== 'string' || e.event.length === 0) return null;
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
