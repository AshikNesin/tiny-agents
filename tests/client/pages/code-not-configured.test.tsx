import React from "react";
import { render as renderBare, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CodePage } from "@/pages/code/CodePage";
import { useCodeStore } from "@/store/code";
import { AppQueryProvider } from "../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

vi.mock("@/lib/code/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/code/api")>();
  return {
    ...original,
    codeApi: { ...original.codeApi, status: vi.fn().mockResolvedValue({ harnesses: [] }) },
  };
});

describe("Code page without a coding agent", () => {
  it("offers a way back to the app and a link to Settings → Models", async () => {
    useCodeStore.setState({ harnesses: [], statuses: {}, threads: null });
    render(
      <MemoryRouter initialEntries={["/code"]}>
        <Routes>
          <Route path="/code" element={<CodePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("No coding agent is connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Settings → Models" })).toHaveAttribute(
      "href",
      "/settings/models",
    );
  });
});
