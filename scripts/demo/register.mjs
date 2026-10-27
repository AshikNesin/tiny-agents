// Demo-only preload (scripts/demo/start.sh): routes pi-ai's faux provider through
// the scripted director and answers the web toolkit's search calls offline.
import { register } from "node:module";
import { searchResults } from "./web-stub.mjs";

register("./hooks.mjs", import.meta.url);

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith("https://api.search.tinyfish.ai")) {
    const query = new URL(url).searchParams.get("query") ?? "";
    const items = searchResults(query);
    await new Promise((r) => setTimeout(r, 1400));
    return new Response(
      JSON.stringify({
        query,
        results: items.map((item, i) => ({
          position: i + 1,
          site_name: new URL(item.url).hostname,
          snippet: item.description,
          title: item.title,
          url: item.url,
        })),
        total_results: items.length,
        page: 0,
      }),
      { headers: { "content-type": "application/json" } },
    );
  }
  return realFetch(input, init);
};
