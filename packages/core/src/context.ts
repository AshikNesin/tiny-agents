import { AsyncLocalStorage } from "node:async_hooks";
import type { Breadcrumb } from "./logger";

export interface RequestContext {
  requestId: string;
  startTime: number;
  breadcrumbs: Breadcrumb[];
  waitUntil?: (promise: Promise<unknown>) => void;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: Partial<RequestContext>, fn: () => T): T {
  return storage.run(
    {
      requestId: context.requestId ?? crypto.randomUUID(),
      startTime: context.startTime ?? Date.now(),
      breadcrumbs: context.breadcrumbs ?? [],
      waitUntil: context.waitUntil,
    },
    fn,
  );
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function waitUntil(promise: Promise<unknown>): void {
  const context = getRequestContext();
  if (context?.waitUntil) {
    context.waitUntil(promise);
    return;
  }
  void promise.catch(() => undefined);
}
