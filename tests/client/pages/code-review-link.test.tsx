/**
 * @vitest-environment jsdom
 *
 * Opening a PR's review from a link: `/code/review?pr=<link or owner/name#N>`,
 * or GitHub's own path after `/code/review/` (swap github.com for the app's
 * host). The app's real routes pick the page; the network is the boundary.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, matchRoutes } from "react-router-dom";
import { appRoutes } from "../../../apps/web/src/client/App";
import { AppQueryProvider } from "../query-provider";

const answer = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function stubFetch() {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => answer({ id: "rv9" }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function visit(url: string) {
  const leaf = matchRoutes(appRoutes, url)?.at(-1)?.route;
  if (!leaf?.path) throw new Error(`no route for ${url}`);
  render(
    <AppQueryProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path={leaf.path} element={leaf.element} />
          <Route path="/code/reviews/:id" element={<p>Review page</p>} />
        </Routes>
      </MemoryRouter>
    </AppQueryProvider>,
  );
}

const opened = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)) as unknown);

afterEach(() => vi.unstubAllGlobals());

describe("a link that opens a PR's review", () => {
  it("takes the PR's GitHub link, or owner/name#N, as ?pr=", async () => {
    const fetch = stubFetch();
    visit(`/code/review?pr=${encodeURIComponent("https://github.com/acme/web/pull/12/files")}`);

    expect(await screen.findByText("Review page")).toBeInTheDocument();
    expect(opened(fetch)).toEqual([{ pr: "https://github.com/acme/web/pull/12/files" }]);
  });

  it("takes GitHub's own path, any tab of it, after /code/review/", async () => {
    const fetch = stubFetch();
    visit("/code/review/acme/web/pull/12/files");

    expect(await screen.findByText("Review page")).toBeInTheDocument();
    expect(opened(fetch)).toEqual([{ pr: "acme/web#12" }]);
  });
});
