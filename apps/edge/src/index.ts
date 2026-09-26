import { handleEvents } from './handlers/events.js';
import { RateLimiter } from './rate-limiter.js';

export interface Env {
  DB: D1Database;
  APPFORGE_ENV: string;
  INGEST_ADMIN_TOKEN: string;
}

const eventsLimiter = new RateLimiter(60, 60_000); // 60 req/min/IP — generous for batched clients

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

    return new Response('Not found', { status: 404 });
  },
};
