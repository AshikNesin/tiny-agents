/**
 * The Code page with no coding agent (issue #242): the app sidebar stays away
 * from `/code`, so the empty state carries the workspace header's way back to
 * the app and links Settings → Models, or a direct link to `/code` is a dead end.
 */
import React from "react";
import { render as renderBare, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CodePage } from "@/pages/code/CodePage";
import { useCodeStore } from "@/store/code";
import { AppQueryProvider } from "../query-provider";

/** Each render gets its own React Query cache, as the app gives the page one. */
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
