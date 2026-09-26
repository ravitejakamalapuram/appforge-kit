export interface Env {
  DB: D1Database;
  APPFORGE_ENV: string;
  INGEST_ADMIN_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/__health') {
      return Response.json({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  },
};
