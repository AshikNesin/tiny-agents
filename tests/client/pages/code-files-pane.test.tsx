/**
 * @vitest-environment jsdom
 */
import { fireEvent, render as renderBare, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { FilesPane } from "@/pages/code/FilesPane";
import { AppQueryProvider } from "../query-provider";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

const base = "/api/v1/code/threads/demo%3Aa";

function stubFetch() {
  const fetch = vi.fn(async (url: string) => {
    const at = new URL(String(url), "http://x");
    const data =
      at.pathname === `${base}/files`
        ? ["README.md", "src/app.ts", "src/lib/util.ts"]
        : at.pathname === `${base}/review/files`
          ? [
              {
                path: "src/app.ts",
                status: "modified",
                additions: 1,
                deletions: 1,
                isGenerated: false,
                hash: "h",
                viewed: false,
              },
            ]
          : at.pathname === `${base}/files/content`
            ? { path: at.searchParams.get("path"), content: "export const app = 1;\n" }
            : [];
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function treeRoot(): Promise<ShadowRoot> {
  let root: ShadowRoot | null | undefined;
  await waitFor(() => {
    root = document.querySelector("file-tree-container")?.shadowRoot;
    if (!root?.querySelector('[data-item-path="src/app.ts"]')) throw new Error("tree not drawn");
  });
  return root!;
}

afterEach(() => vi.unstubAllGlobals());

describe("the Files tab", () => {
  it("opens the worktree in an editor from the top of the tab", async () => {
    stubFetch();
    const harness = {
      id: "shelley",
      kind: "shelley",
      label: "Shelley",
      status: { state: "connected" as const },
      capabilities: NO_CAPABILITIES,
      commands: [],
      ssh: { host: "my-vm", user: "exedev", port: null, keyFile: null },
    };
    render(
      <FilesPane
        threadId="demo:a"
        refreshKey="1"
        editor={{ harness, folder: "/home/exedev/code/acme--web" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(await screen.findByLabelText("SSH host")).toHaveValue("exedev@my-vm");
    expect(screen.getByText("/home/exedev/code/acme--web")).toBeInTheDocument();
  });

  it("lists the worktree as folders, marking the file the agent changed", async () => {
    stubFetch();
    render(<FilesPane threadId="demo:a" refreshKey="1" />);
    const root = await treeRoot();
    expect(root.querySelector('[data-item-path="src/"]')).not.toBeNull();
    expect(root.querySelector('[data-item-path="README.md"]')).not.toBeNull();
    expect(
      root.querySelector('[data-item-path="src/app.ts"]')?.getAttribute("data-item-git-status"),
    ).toBe("modified");
  });

  it("picking a file in the tree opens it beside the tree", async () => {
    stubFetch();
    render(<FilesPane threadId="demo:a" refreshKey="1" />);
    const root = await treeRoot();
    fireEvent.click(root.querySelector('[data-item-path="src/app.ts"]')!);
    expect(await screen.findByText("export const app = 1;", { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId("code-file-path")).toHaveTextContent("src/app.ts");
  });

  it("p pressed before the tree has loaded opens its name filter once it draws", async () => {
    stubFetch();
    render(<FilesPane threadId="demo:a" refreshKey="1" focus={{ which: "name", at: 1 }} />);
    const root = await treeRoot();
    await waitFor(() =>
      expect(
        root.querySelector("[data-file-tree-search-container]")?.getAttribute("data-open"),
      ).toBe("true"),
    );
  });

  it("a closed file opens again when picked again", async () => {
    stubFetch();
    render(<FilesPane threadId="demo:a" refreshKey="1" />);
    const root = await treeRoot();
    fireEvent.click(root.querySelector('[data-item-path="src/app.ts"]')!);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("code-file-path")).toBeNull();
    fireEvent.click(root.querySelector('[data-item-path="src/app.ts"]')!);
    expect(await screen.findByTestId("code-file-path")).toHaveTextContent("src/app.ts");
  });
});
