import { handleEvents } from './handlers/events.js';
import { handleGetMetrics } from './handlers/metrics.js';
import { handleFeedback } from './handlers/feedback.js';
import { handleGetConfig } from './handlers/config.js';
import { handleIngest, isAuthorized } from './handlers/ingest.js';
import { RateLimiter } from './rate-limiter.js';

export type Env = Cloudflare.Env;

const eventsLimiter = new RateLimiter(60, 60_000); // 60 req/min/IP — generous for batched clients
const feedbackLimiter = new RateLimiter(30, 60_000);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    if (url.pathname === '/v1/metrics' && request.method === 'GET') {
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
      return handleGetConfig(decodeURIComponent(configMatch[1]), env.DB);
    }

    const ingestMatch = url.pathname.match(/^\/v1\/ingest\/([^/]+)$/);
    if (ingestMatch && request.method === 'POST') {
      if (!isAuthorized(request, env.INGEST_ADMIN_TOKEN)) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      return handleIngest(request, decodeURIComponent(ingestMatch[1]), env.DB);
    }

    return new Response('Not found', { status: 404 });
  },
};
