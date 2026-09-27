import { EdgeClient, EdgeRequestError, type EdgeFetcher } from '../edge-client.js';
import { buildOutput, printOutput } from '../output.js';

export interface MetricsShowOptions {
  product: string;
  name?: string;
  since?: string;
  edgeUrl?: string;
  edgeToken?: string;
  json: boolean;
}

export interface MetricsShowDeps {
  /** Injected only by tests; the real CLI never passes this, so EdgeClient uses the global fetch. */
  fetcher?: EdgeFetcher;
}

/**
 * Exit codes: 0 ok, 2 invalid input (no edge URL/token resolvable from flags or env), 14 data gap
 * (edge reachable and authorized but returned zero rows for this product/filter), 17 edge request
 * failed (non-2xx response or a transport-level failure reaching the edge).
 */
export async function runMetricsShow(opts: MetricsShowOptions, deps: MetricsShowDeps = {}): Promise<number> {
  const edgeUrl = opts.edgeUrl ?? process.env.APPFORGE_EDGE_URL;
  const edgeToken = opts.edgeToken ?? process.env.APPFORGE_EDGE_TOKEN;

  if (!edgeUrl) {
    printOutput(buildOutput('metrics show', false, undefined, ['no edge URL: pass --edge-url or set APPFORGE_EDGE_URL']), opts.json);
    return 2;
  }
  if (!edgeToken) {
    printOutput(buildOutput('metrics show', false, undefined, ['no edge token: pass --edge-token or set APPFORGE_EDGE_TOKEN']), opts.json);
    return 2;
  }

  const client = new EdgeClient({ edgeUrl, edgeToken, fetcher: deps.fetcher });

  let rows;
  try {
    rows = await client.getMetrics({ product: opts.product, name: opts.name, from: opts.since });
  } catch (err) {
    const message = err instanceof EdgeRequestError ? err.message : (err as Error).message;
    printOutput(buildOutput('metrics show', false, undefined, [message]), opts.json);
    return 17;
  }

  if (rows.length === 0) {
    printOutput(
      buildOutput('metrics show', false, undefined, [
        `no metrics found for product "${opts.product}"${opts.name ? ` name "${opts.name}"` : ''}${opts.since ? ` since ${opts.since}` : ''}`,
      ]),
      opts.json
    );
    return 14;
  }

  printOutput(buildOutput('metrics show', true, { product: opts.product, rows }), opts.json);
  return 0;
}
