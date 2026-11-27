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
import type { BotListEntry } from "../../../apps/web/src/shared/api/bots";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import { FIXED_NOW } from "../../test-clock";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);

let api: ReturnType<typeof fakeApi>;

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const user = userEvent.setup();
const bot = (id: string, name: string, description: string): BotListEntry => ({
  id,
  conversationId: `c-${id}`,
  name,
  description,
  modelId: null,
  lastMessagePreview: null,
  lastActivityAt: FIXED_NOW,
  lastReadAt: null,
  unread: false,
  replying: false,
  approvals: 0,
  questions: 0,
  pinnedAt: null,
  projectId: null,
});
const BOTS = [bot("b1", "Helper Bot", "Helps"), bot("b2", "Journal Bot", "")];

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
  api = fakeApi();
  api.get("/bots", () => BOTS);
});

describe("sharing with every bot", () => {
  it("turns a skill on for every bot from its page", async () => {
    api.get("/skills", (): Skill[] => []);
    api.get("/skills/:id", () => skill);
    api.patch("/skills/:id", (): Skill => ({ ...skill, allBots: true, botIds: ["b1", "b2"] }));
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
    await settle();
    expect(api.sent("PATCH", "/skills/s1").map((request) => request.body)).toEqual([
      { allBots: true },
    ]);
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
    useBotsStore.setState({ bots: BOTS, loading: false });
    api.get("/connections/:id", () => connection);
    api.patch("/connections/:id", (): Connection => ({
      ...connection,
      allBots: true,
      botIds: ["b1", "b2"],
    }));
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
    await settle();
    expect(api.sent("PATCH", "/connections/c1").map((request) => request.body)).toEqual([
      { allBots: true },
    ]);
    expect(screen.getByRole("switch", { name: "Every bot" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});
