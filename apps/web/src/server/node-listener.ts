import { getRequestListener } from "@hono/node-server";

type FetchHandler = Parameters<typeof getRequestListener>[0];

export function nodeRequestListener(fetch: FetchHandler) {
  return getRequestListener(fetch, { overrideGlobalObjects: false });
}
