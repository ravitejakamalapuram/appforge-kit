import { handleEvents } from './handlers/events.js';
import { handleGetMetrics } from './handlers/metrics.js';
import { handleFeedback } from './handlers/feedback.js';
import { handleGetConfig } from './handlers/config.js';
import { handleIngest, isAuthorized } from './handlers/ingest.js';
import { RateLimiter } from './rate-limiter.js';

export type Env = Cloudflare.Env;

const eventsLimiter = new RateLimiter(60, 60_000); // 60 req/min/IP — generous for batched clients
const feedbackLimiter = new RateLimiter(30, 60_000);

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/__health') {
    return Response.json({ ok: true });
  }

  if (url.pathname === '/v1/events' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!eventsLimiter.allow(ip)) {
      return Response.json({ error: 'rate limit exceeded' }, { status: 429 });
    }
    return handleEvents(request, env.DB);
  }

  // Reads are bearer-gated too (§29e: "read/ingest: bearer tokens with role scopes"). Reusing
  // the ingest admin token as one shared internal-operator scope for now, rather than minting a
  // second secret before there is a second real caller that needs a narrower one — see this
  // plan's Task 6 (final review) ledger entry.
  if (url.pathname === '/v1/metrics' && request.method === 'GET') {
    if (!isAuthorized(request, env.INGEST_ADMIN_TOKEN)) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    return handleGetMetrics(url, env.DB);
  }

  if (url.pathname === '/v1/feedback' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!feedbackLimiter.allow(ip)) {
      return Response.json({ error: 'rate limit exceeded' }, { status: 429 });
    }
    return handleFeedback(request, env.DB);
  }

  const configMatch = url.pathname.match(/^\/v1\/config\/([^/]+)$/);
  if (configMatch && request.method === 'GET') {
    let product: string;
    try {
      product = decodeURIComponent(configMatch[1]);
    } catch {
      return Response.json({ error: 'malformed product in path' }, { status: 400 });
    }
    return handleGetConfig(product, env.DB);
  }

  const ingestMatch = url.pathname.match(/^\/v1\/ingest\/([^/]+)$/);
  if (ingestMatch && request.method === 'POST') {
    if (!isAuthorized(request, env.INGEST_ADMIN_TOKEN)) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    let source: string;
    try {
      source = decodeURIComponent(ingestMatch[1]);
    } catch {
      return Response.json({ error: 'malformed source in path' }, { status: 400 });
    }
    return handleIngest(request, source, env.DB);
  }

  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      // Never let an uncaught exception (a D1 error, an unexpected throw in a handler, ...)
      // reach the Workers runtime as an opaque 1101 error — always answer with real JSON so a
      // caller can tell "the server broke" from "the edge is unreachable".
      console.error('unhandled error', err);
      return Response.json({ error: 'internal error' }, { status: 500 });
    }
  },
};
