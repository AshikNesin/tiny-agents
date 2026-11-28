import { ConfirmProvider } from "@groot/ui/primitives";
import React from "react";
import { render as renderBare, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CodeWorkspace } from "@/pages/code/Workspace";
import { useCodeStore } from "@/store/code";
import type { ProjectView } from "../../../apps/web/src/shared/api/code";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

describe("Code page without a coding agent", () => {
  it("offers a way back to the app and a link to Settings → Models", async () => {
    const api = fakeApi();
    api.get("/code/status", () => ({ harnesses: [] }));
    api.get("/code/projects", (): ProjectView[] => []);
    useCodeStore.setState({ harnesses: [], statuses: {}, threads: null });
    render(
      <ConfirmProvider>
        <MemoryRouter initialEntries={["/code"]}>
          <Routes>
            <Route path="/code" element={<CodeWorkspace />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>,
    );
    expect(await screen.findByText("No coding agent is connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Settings → Models" })).toHaveAttribute(
      "href",
      "/settings/models",
    );
  });
});
