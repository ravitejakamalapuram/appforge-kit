import type { D1Database } from '@cloudflare/workers-types';
import { validateEnvelope } from '../validate-envelope.js';
import { getAllowlist, filterProps } from '../allowlist.js';

const MAX_BATCH_SIZE = 50;

export async function handleEvents(request: Request, db: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return Response.json({ error: 'body must be an array of event envelopes' }, { status: 400 });
  }
  if (body.length === 0) {
    return Response.json({ error: 'body must contain at least one event' }, { status: 400 });
  }
  if (body.length > MAX_BATCH_SIZE) {
    return Response.json({ error: `batch exceeds the ${MAX_BATCH_SIZE}-event limit` }, { status: 400 });
  }

  const receivedAt = Date.now();
  let accepted = 0;
  for (const raw of body) {
    const envelope = validateEnvelope(raw);
    if (!envelope) continue; // a malformed entry is dropped, not fatal for the whole batch
    const allowlist = getAllowlist(envelope.product);
    if (!allowlist || !allowlist.allowedEvents.has(envelope.event)) continue;
    const props = filterProps(envelope.event, envelope.props, allowlist);
    await db
      .prepare(
        `INSERT OR IGNORE INTO events_raw (install_id, seq, product, app_version, env, event, props, ts, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        envelope.install_id,
        envelope.seq,
        envelope.product,
        envelope.app_version,
        envelope.env,
        envelope.event,
        JSON.stringify(props),
        envelope.ts,
        receivedAt
      )
      .run();
    accepted++;
  }
  return Response.json({ accepted }, { status: 202 });
}
