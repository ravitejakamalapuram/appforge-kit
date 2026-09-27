import { EdgeClient, EdgeRequestError, type EdgeFetcher, type MetricRow } from '../edge-client.js';
import { detectAnomalies } from '@appforge/schemas';
import { buildOutput, printOutput } from '../output.js';

export interface MetricsAnomaliesOptions {
  product: string;
  name?: string;
  edgeUrl?: string;
  edgeToken?: string;
  json: boolean;
}

export interface MetricsAnomaliesDeps {
  fetcher?: EdgeFetcher;
}

interface FlaggedAnomaly {
  name: string;
  date: string;
  value: number;
  trailingMean: number;
  trailingStdDev: number;
  zScore: number;
}

function groupByName(rows: MetricRow[]): Map<string, MetricRow[]> {
  const groups = new Map<string, MetricRow[]>();
  for (const row of rows) {
    const group = groups.get(row.name);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.name, [row]);
    }
  }
  return groups;
}

/**
 * Exit codes: 0 ok (the check ran; data.anomalies may legitimately be empty — finding nothing is
 * success, not failure), 2 invalid input (no edge URL/token resolvable), 14 data gap (the edge
 * returned zero metric rows for this product at all, so there is nothing to check), 17 edge
 * request failed (non-2xx or transport failure).
 *
 * Runs GET /v1/metrics for the product (optionally narrowed by --name), groups the rows by metric
 * name (a product can have several series: installs, wau, ...), and runs the deterministic
 * trailing z-score check (@appforge/schemas's detectAnomalies) independently per series.
 */
export async function runMetricsAnomalies(opts: MetricsAnomaliesOptions, deps: MetricsAnomaliesDeps = {}): Promise<number> {
  const edgeUrl = opts.edgeUrl ?? process.env.APPFORGE_EDGE_URL;
  const edgeToken = opts.edgeToken ?? process.env.APPFORGE_EDGE_TOKEN;

  if (!edgeUrl) {
    printOutput(buildOutput('metrics anomalies', false, undefined, ['no edge URL: pass --edge-url or set APPFORGE_EDGE_URL']), opts.json);
    return 2;
  }
  if (!edgeToken) {
    printOutput(buildOutput('metrics anomalies', false, undefined, ['no edge token: pass --edge-token or set APPFORGE_EDGE_TOKEN']), opts.json);
    return 2;
  }

  const client = new EdgeClient({ edgeUrl, edgeToken, fetcher: deps.fetcher });

  let rows: MetricRow[];
  try {
    rows = await client.getMetrics({ product: opts.product, name: opts.name });
  } catch (err) {
    const message = err instanceof EdgeRequestError ? err.message : (err as Error).message;
    printOutput(buildOutput('metrics anomalies', false, undefined, [message]), opts.json);
    return 17;
  }

  if (rows.length === 0) {
    printOutput(
      buildOutput('metrics anomalies', false, undefined, [
        `no metrics found for product "${opts.product}"${opts.name ? ` name "${opts.name}"` : ''} to check for anomalies`,
      ]),
      opts.json
    );
    return 14;
  }

  const anomalies: FlaggedAnomaly[] = [];
  for (const [name, seriesRows] of groupByName(rows)) {
    const results = detectAnomalies(seriesRows.map((r) => ({ date: r.date, value: r.value })));
    for (const result of results) {
      if (result.isAnomaly) {
        anomalies.push({
          name,
          date: result.date,
          value: result.value,
          trailingMean: result.trailingMean,
          trailingStdDev: result.trailingStdDev,
          zScore: result.zScore,
        });
      }
    }
  }

  printOutput(buildOutput('metrics anomalies', true, { product: opts.product, anomalies }), opts.json);
  return 0;
}
