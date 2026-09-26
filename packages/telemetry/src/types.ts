/** The wire envelope sent to appforge-edge POST /v1/events (master plan §18b, taxonomy@1). */
export interface EventEnvelope {
  v: 1;
  product: string;
  app_version: string;
  env: 'dev' | 'staging' | 'prod';
  install_id: string;
  session_id: string;
  ts: number;
  event: string;
  props: Record<string, unknown>;
  seq: number;
}

export interface TelemetryQueueOptions {
  product: string;
  appVersion: string;
  env: 'dev' | 'staging' | 'prod';
  installId: string;
  sessionId: string;
  /** Oldest events are dropped once the queue holds this many (default 500, per §18b). */
  maxQueueSize?: number;
  now?: () => number;
}
