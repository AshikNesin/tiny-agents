import { register } from "node:module";

const DIRECTOR = new URL("./montage-director.mjs", import.meta.url).href;
const hooks = `
const FAUX = "@earendil-works/pi-ai/providers/faux";
const DIRECTOR = ${JSON.stringify(DIRECTOR)};
export async function resolve(specifier, context, next) {
  if (specifier === FAUX && context.parentURL !== DIRECTOR) return { url: DIRECTOR, shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const RESULTS = [
  {
    title: "Goa beach hostels under ₹1,500",
    url: "https://hostels.example.com/goa",
    snippet: "Dorm beds near Palolem, Anjuna and Arambol, with nightly prices.",
  },
  {
    title: "Palolem: quiet beach stays",
    url: "https://hostels.example.com/goa/palolem",
    snippet: "Dorms from ₹900 to ₹1,400 a night.",
  },
  {
    title: "Anjuna and Arambol on a budget",
    url: "https://hostels.example.com/goa/north",
    snippet: "Anjuna ₹700 to ₹1,200, Arambol ₹600 to ₹1,100.",
  },
];

const PAGE = [
  "# Goa beach hostels under ₹1,500",
  "",
  "- Palolem: quiet beach, ₹900 to ₹1,400",
  "- Anjuna: lively, ₹700 to ₹1,200",
  "- Arambol: long stays, ₹600 to ₹1,100",
].join("\n");

const json = (body) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input.url ?? String(input));
  if (url.startsWith("https://api.search.tinyfish.ai")) {
    await pause(1300);
    const query = new URL(url).searchParams.get("query") ?? "";
    return json({
      query,
      results: RESULTS.map((item, i) => ({
        position: i + 1,
        site_name: new URL(item.url).hostname,
        ...item,
      })),
      total_results: RESULTS.length,
      page: 0,
    });
  }
  if (url.startsWith("https://api.fetch.tinyfish.ai")) {
    await pause(1900);
    const asked = JSON.parse(init?.body ?? "{}").urls?.[0] ?? RESULTS[0].url;
    return json({
      results: [{ url: asked, final_url: asked, title: RESULTS[0].title, text: PAGE }],
      errors: [],
    });
  }
  return realFetch(input, init);
};
