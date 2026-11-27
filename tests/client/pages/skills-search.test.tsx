import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { SkillsPage } from "@/pages/skills/Skills";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

function skill(partial: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "Claude Helper",
    description: "Everyday assistance",
    body: "",
    files: [],
    source: "manual",
    sourceUrl: null,
    allBots: false,
    botIds: [],
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...partial,
  };
}

function mount(skills: Skill[]) {
  fakeApi().get("/skills", () => skills);
  return render(
    <AppQueryProvider>
      <MemoryRouter>
        <GrootUIProvider>
          <SkillsPage />
        </GrootUIProvider>
      </MemoryRouter>
    </AppQueryProvider>,
  );
}

describe("skills search", () => {
  it("matches a skill's name case-insensitively", async () => {
    mount([skill()]);
    const search = await screen.findByLabelText("Search skills");
    await userEvent.type(search, "claude");
    expect(screen.getByText("Claude Helper")).toBeTruthy();
    expect(screen.queryByText(/No matching skills/)).toBeNull();
  });

  it("matches a skill's name with an upper-case query", async () => {
    mount([skill()]);
    const search = await screen.findByLabelText("Search skills");
    await userEvent.type(search, "HELPER");
    expect(screen.getByText("Claude Helper")).toBeTruthy();
  });

  it("still hides skills that match neither name nor description", async () => {
    mount([skill()]);
    const search = await screen.findByLabelText("Search skills");
    await userEvent.type(search, "kubernetes");
    expect(screen.getByText(/Nothing matches "kubernetes"/)).toBeTruthy();
  });
});
