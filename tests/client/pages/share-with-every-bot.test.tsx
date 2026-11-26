/**
 * @vitest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { SkillDetail } from "@/pages/skills/SkillDetail";
import { ConnectionDetail } from "@/pages/connections/ConnectionDetail";
import { StepUpProvider } from "@/components/vault/StepUp";
import { useBotsStore } from "@/store/bots";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import { AppQueryProvider } from "../query-provider";

const api = vi.hoisted(() => ({
  botsList: vi.fn(),
  skillGet: vi.fn(),
  skillUpdate: vi.fn(),
  connectionGet: vi.fn(),
  connectionUpdate: vi.fn(),
}));

vi.mock("@/lib/bots-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/bots-api")>();
  return {
    ...original,
    botsApi: { ...original.botsApi, list: (...args: unknown[]) => api.botsList(...args) },
  };
});
vi.mock("@/lib/skills-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/skills-api")>();
  return {
    ...original,
    skillsApi: {
      get: (...args: unknown[]) => api.skillGet(...args),
      update: (...args: unknown[]) => api.skillUpdate(...args),
      remove: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
  };
});
vi.mock("@/lib/connections-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/connections-api")>();
  return {
    ...original,
    connectionsApi: {
      get: (...args: unknown[]) => api.connectionGet(...args),
      update: (...args: unknown[]) => api.connectionUpdate(...args),
      updateTool: vi.fn(),
      reconnect: vi.fn(),
      remove: vi.fn(),
    },
  };
});
vi.mock("@/lib/sse", () => ({ subscribeSse: vi.fn(() => ({ close: () => undefined })) }));

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const user = userEvent.setup();
const BOTS = [
  { id: "b1", name: "Helper Bot", description: "Helps" },
  { id: "b2", name: "Journal Bot", description: "" },
];

const skill: Skill = {
  id: "s1",
  name: "deploy",
  description: "Deploy the app",
  body: "Run it.",
  files: [],
  source: "manual",
  sourceUrl: null,
  allBots: false,
  botIds: ["b1"],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const connection: Connection = {
  id: "c1",
  name: "Notion",
  slug: "notion",
  url: "https://mcp.notion.example",
  transport: "streamable-http",
  authType: "none",
  headerName: null,
  hasSecret: false,
  secretRef: null,
  tools: [],
  allBots: false,
  botIds: ["b1"],
  status: "connected",
  createdAt: "2026-10-01T00:00:00.000Z",
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("sharing with every bot", () => {
  it("turns a skill on for every bot from its page", async () => {
    api.skillGet.mockResolvedValue(skill);
    api.botsList.mockResolvedValue(BOTS);
    api.skillUpdate.mockResolvedValue({ ...skill, allBots: true, botIds: ["b1", "b2"] });
    const router = createMemoryRouter([{ path: "/skills/:id", element: <SkillDetail id="s1" /> }], {
      initialEntries: ["/skills/s1"],
    });
    render(
      <AppQueryProvider>
        <GrootUIProvider>
          <RouterProvider router={router} />
        </GrootUIProvider>
      </AppQueryProvider>,
    );
    await settle();
    const every = await screen.findByRole("switch", { name: "Every bot" });
    expect(every.getAttribute("aria-checked")).toBe("false");

    await user.click(every);
    expect(api.skillUpdate).toHaveBeenCalledWith("s1", { allBots: true });
    await settle();
    expect(screen.getByRole("switch", { name: "Every bot" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      (screen.getByLabelText("Use deploy with Journal Bot") as HTMLButtonElement).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });

  it("turns a connection on for every bot from its page", async () => {
    useBotsStore.setState({ bots: BOTS as never, loading: false });
    api.connectionGet.mockResolvedValue(connection);
    api.connectionUpdate.mockResolvedValue({ ...connection, allBots: true, botIds: ["b1", "b2"] });
    render(
      <AppQueryProvider>
        <MemoryRouter>
          <GrootUIProvider>
            <StepUpProvider>
              <ConnectionDetail id="c1" />
            </StepUpProvider>
          </GrootUIProvider>
        </MemoryRouter>
      </AppQueryProvider>,
    );
    await settle();
    const every = await screen.findByRole("switch", { name: "Every bot" });
    await user.click(every);
    expect(api.connectionUpdate).toHaveBeenCalledWith("c1", { allBots: true });
    await settle();
    expect(screen.getByRole("switch", { name: "Every bot" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});
