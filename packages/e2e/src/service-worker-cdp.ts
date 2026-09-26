import type { CDPSession } from 'playwright';

export interface ServiceWorkerVersion {
  versionId: string;
  registrationId: string;
  scriptURL: string;
  runningStatus: string;
  status: string;
}

interface WorkerVersionUpdatedEvent {
  versions: ServiceWorkerVersion[];
}

/**
 * A tiny wrapper around the CDP `ServiceWorker` domain, shared by the smoke and SW-restart
 * checks (Tasks 2–3). `Target.closeTarget` was tried first for forcing a restart and found
 * unreliable for service-worker-type targets — see this plan's Review Focus item 1.
 * `ServiceWorker.stopWorker` is the domain actually built for this.
 */
export class ServiceWorkerTracker {
  private readonly versions = new Map<string, ServiceWorkerVersion>();
  private enabled = false;

  constructor(private readonly cdp: CDPSession) {
    cdp.on('ServiceWorker.workerVersionUpdated', (params: WorkerVersionUpdatedEvent) => {
      for (const v of params.versions) this.versions.set(v.versionId, v);
    });
  }

  async enable(): Promise<void> {
    if (this.enabled) return;
    await this.cdp.send('ServiceWorker.enable');
    this.enabled = true;
  }

  find(extensionId: string): ServiceWorkerVersion | undefined {
    return [...this.versions.values()].find((v) => v.scriptURL.includes(extensionId));
  }

  get(versionId: string): ServiceWorkerVersion | undefined {
    return this.versions.get(versionId);
  }

  async stop(versionId: string): Promise<void> {
    await this.cdp.send('ServiceWorker.stopWorker', { versionId });
  }

  /** Polls `predicate` every 100ms until it returns true or `timeoutMs` elapses. */
  async waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return predicate();
  }
}
