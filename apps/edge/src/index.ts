import { handleEvents } from './handlers/events.js';
import { handleGetMetrics } from './handlers/metrics.js';
import { handleFeedback } from './handlers/feedback.js';
import { RateLimiter } from './rate-limiter.js';

export interface Env {
  DB: D1Database;
  APPFORGE_ENV: string;
  INGEST_ADMIN_TOKEN: string;
}

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

    return new Response('Not found', { status: 404 });
  },
};
