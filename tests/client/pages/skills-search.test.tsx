import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { SkillsPage } from "@/pages/skills/Skills";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import { AppQueryProvider } from "../query-provider";

const listMock = vi.fn();

vi.mock("@/lib/skills-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/skills-api")>();
  return {
    ...original,
    skillsApi: {
      ...original.skillsApi,
      list: (...args: unknown[]) => listMock(...args),
    },
  };
});

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
  listMock.mockResolvedValue(skills);
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
  beforeEach(() => {
    listMock.mockReset();
  });

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
