import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GrootUIProvider } from "@groot/ui";
import { CreateSkillDialog } from "@/components/skills/CreateSkillDialog";
import type { Skill } from "../../../../apps/web/src/shared/api/skills";
import { AppQueryProvider } from "../../query-provider";

const createMock = vi.fn();

vi.mock("@/lib/skills-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/skills-api")>();
  return {
    ...original,
    skillsApi: {
      ...original.skillsApi,
      create: (...args: unknown[]) => createMock(...args),
    },
  };
});

function skill(partial: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "pdf-fill",
    description: "Fills PDFs",
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

function mount() {
  return render(
    <AppQueryProvider>
      <GrootUIProvider>
        <CreateSkillDialog open onOpenChange={() => {}} onCreated={() => {}} />
      </GrootUIProvider>
    </AppQueryProvider>,
  );
}

describe("CreateSkillDialog validation (issue #122)", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("shows the name error after blur when the name has invalid characters", async () => {
    const user = userEvent.setup();
    mount();
    const name = screen.getByLabelText("Name");
    await user.type(name, "Bad Name!");
    await user.tab();
    expect(await screen.findByText(/Lowercase letters, digits/i)).toBeTruthy();
  });

  it("shows the description error after blur when it is empty", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByLabelText("Description"));
    await user.tab();
    expect(await screen.findByText("Description is required.")).toBeTruthy();
  });

  it("keeps errors hidden until the field is touched", async () => {
    mount();
    expect(screen.queryByText("Description is required.")).toBeNull();
    expect(screen.queryByText(/single hyphens/i)).toBeNull();
  });

  it("creates the skill when the form is valid", async () => {
    createMock.mockResolvedValue(skill());
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("Name"), "pdf-fill");
    await user.type(screen.getByLabelText("Description"), "Fills PDFs");
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    await vi.waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        name: "pdf-fill",
        description: "Fills PDFs",
        body: "",
      }),
    );
  });
});
