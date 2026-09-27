/**
 * Minimal fetch surface EdgeClient needs, injected the same way `packages/flags`'s FlagsFetcher
 * is — so this module never touches the network in a test, and the real deployed edge worker
 * (https://appforge-edge.echokit-rk.workers.dev) is never called from CI or from this repo's own
 * test suite.
 */
export interface EdgeFetcher {
  fetch(url: string, init: { headers: Record<string, string> }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

/** Matches the row shape apps/edge/src/handlers/metrics.ts's GET /v1/metrics returns. */
export interface MetricRow {
  product: string;
  date: string;
  name: string;
  value: number;
  source: string;
}

/** Thrown for any non-2xx response or transport-level failure talking to the edge. */
export class EdgeRequestError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'EdgeRequestError';
    this.status = status;
  }
}

export interface EdgeClientOptions {
  edgeUrl: string;
  edgeToken: string;
  /** Defaults to the global fetch; pass a fake in tests. */
  fetcher?: EdgeFetcher;
}

export interface GetMetricsParams {
  product: string;
  name?: string;
  from?: string;
  to?: string;
}

const defaultFetcher: EdgeFetcher = {
  fetch: (url, init) => fetch(url, init),
};

export class EdgeClient {
  private readonly fetcher: EdgeFetcher;

  constructor(private readonly opts: EdgeClientOptions) {
    this.fetcher = opts.fetcher ?? defaultFetcher;
  }

  async getMetrics(params: GetMetricsParams): Promise<MetricRow[]> {
    const url = new URL('/v1/metrics', this.opts.edgeUrl);
    url.searchParams.set('product', params.product);
    if (params.name) url.searchParams.set('name', params.name);
    if (params.from) url.searchParams.set('from', params.from);
    if (params.to) url.searchParams.set('to', params.to);

    let response: { ok: boolean; status: number; json(): Promise<unknown> };
    try {
      response = await this.fetcher.fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.opts.edgeToken}` },
      });
    } catch (err) {
      throw new EdgeRequestError(`edge request to ${url.toString()} failed: ${(err as Error).message}`);
    }

    if (!response.ok) {
      throw new EdgeRequestError(`edge request to ${url.toString()} returned status ${response.status}`, response.status);
    }

    const body = (await response.json()) as { metrics: MetricRow[] };
    return body.metrics;
  }
}
