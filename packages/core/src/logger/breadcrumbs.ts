import { getRequestContext } from "../context";

export interface Breadcrumb {
  timestamp: string;
  category: string;
  message: string;
  level: "debug" | "info" | "warn" | "error";
  data?: Record<string, unknown>;
}

const MAX_BREADCRUMBS = 50;

/**
 * Record a step on the current request's trail. Breadcrumbs are attached to
 * error logs so a failure shows what led up to it. Outside a request context
 * they are dropped.
 */
export function addBreadcrumb(
  category: string,
  message: string,
  level: Breadcrumb["level"] = "info",
  data?: Record<string, unknown>,
): void {
  const context = getRequestContext();
  if (!context) return;
  context.breadcrumbs.push({ timestamp: new Date().toISOString(), category, message, level, data });
  if (context.breadcrumbs.length > MAX_BREADCRUMBS) context.breadcrumbs.shift();
}

export function getBreadcrumbs(): Breadcrumb[] {
  return [...(getRequestContext()?.breadcrumbs ?? [])];
}

export function clearBreadcrumbs(): void {
  const context = getRequestContext();
  if (context) context.breadcrumbs.length = 0;
}
