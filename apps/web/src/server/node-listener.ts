import { getRequestListener } from "@hono/node-server";

type FetchHandler = Parameters<typeof getRequestListener>[0];

export function nodeRequestListener(fetch: FetchHandler) {
  const NativeResponse = globalThis.Response;
  const listener = getRequestListener(fetch);
  Object.defineProperty(globalThis, "Response", { value: NativeResponse });
  return listener;
}
