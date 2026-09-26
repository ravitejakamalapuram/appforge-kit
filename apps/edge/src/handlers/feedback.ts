import type { D1Database } from '@cloudflare/workers-types';

interface FeedbackInput {
  product: unknown;
  source: unknown;
  rating: unknown;
  text: unknown;
}

const MAX_SHORT_FIELD_LENGTH = 64;
const MAX_TEXT_LENGTH = 2000;

function validateFeedback(input: unknown): { product: string; source: string; rating: number | null; text: string } | null {
  if (typeof input !== 'object' || input === null) return null;
  const f = input as FeedbackInput;
  if (typeof f.product !== 'string' || f.product.length === 0 || f.product.length > MAX_SHORT_FIELD_LENGTH) return null;
  if (typeof f.source !== 'string' || f.source.length === 0 || f.source.length > MAX_SHORT_FIELD_LENGTH) return null;
  if (typeof f.text !== 'string' || f.text.length === 0 || f.text.length > MAX_TEXT_LENGTH) return null;
  let rating: number | null = null;
  if (f.rating !== undefined && f.rating !== null) {
    if (typeof f.rating !== 'number' || !Number.isInteger(f.rating) || f.rating < 1 || f.rating > 5) return null;
    rating = f.rating;
  }
  return { product: f.product, source: f.source, rating, text: f.text };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleFeedback(request: Request, db: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const feedback = validateFeedback(body);
  if (!feedback) {
    return Response.json({ error: 'product, source, and text are required' }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const textHash = await sha256Hex(feedback.text);
  // Raw text is deliberately not persisted here — a 90-day raw-text table for the weekly
  // feedback classifier is P2-02's job, not this plan's. text_hash exists now as a dedup key.
  await db
    .prepare(
      `INSERT INTO feedback (id, product, source, rating, text_hash, category, cluster_key, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`
    )
    .bind(id, feedback.product, feedback.source, feedback.rating, textHash, new Date().toISOString())
    .run();
  return Response.json({ id }, { status: 202 });
}
