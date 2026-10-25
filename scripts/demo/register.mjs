// Demo-only preload (scripts/demo/start.sh): routes pi-ai's faux provider through
// the scripted director and answers the web toolkit's search calls offline.
import { register } from "node:module";
import { searchResults } from "./web-stub.mjs";

register("./hooks.mjs", import.meta.url);

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (/\/ai\/websearch\/?$/.test(url)) {
    const body = JSON.parse(init?.body ?? "{}");
    await new Promise((r) => setTimeout(r, 1400));
    return new Response(
      JSON.stringify({ success: true, result: { items: searchResults(body.query) } }),
      {
        headers: { "content-type": "application/json" },
      },
    );
  }
  return realFetch(input, init);
};
