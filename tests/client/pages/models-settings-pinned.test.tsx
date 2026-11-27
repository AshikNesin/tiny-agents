/**
 * @vitest-environment jsdom
 *
 * Settings → Models pinned card by card: the element tree with roles, names,
 * test ids and text, and the whole markup, while loading, with nothing set
 * up, and with accounts of each kind and status (folded and open: model
 * rows with their chips and warnings, a Claude plan's fallback and max
 * turns, a gateway's base-path warnings, Add a model), the default models,
 * the edit dialog for each kind of account, and the move-and-delete dialog
 * a model in use asks with. Recorded on the one-file page before it was
 * split (docs/rewrite/PLAN.md row 5.6), so the split must render each the
 * same. The Claude plan's status panel is a stand-in (it is not split).
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiError } from "@groot/shell/lib/api";
import { ConfirmProvider } from "@groot/ui/primitives";
import { ModelsSettings } from "@/pages/settings/models/ModelsSettings";
import type {
  Account,
  AccountModel,
  ProviderTemplate,
} from "../../../apps/web/src/shared/api/models";
import { AppQueryProvider } from "../query-provider";
import { markup, outline } from "../dom-outline";

const api = vi.hoisted(() => ({
  accounts: vi.fn(),
  roles: vi.fn(),
  available: vi.fn(),
  removeModel: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/lib/models-api", () => ({ modelsApi: api }));
vi.mock("@/lib/vault-api", () => ({
  hasStepUp: () => true,
  apiError: (_error: unknown, fallback: string) => fallback,
  StepUpRequiredError: class extends Error {},
  vaultApi: { confirmWithPassword: vi.fn(), confirmWithPasskey: vi.fn() },
}));
vi.mock("@/store/bots", () => ({
  useBotsStore: (select: (s: { loadModels: () => Promise<void> }) => unknown) =>
    select({ loadModels: async () => undefined }),
}));
vi.mock("@/components/ClaudePlanStatus", () => ({
  ClaudePlanStatus: () => <div data-stand-in="claude-plan-status" />,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

const TEMPLATES: ProviderTemplate[] = [
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com" },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    aggregator: true,
  },
];

const ROLES = Object.fromEntries(
  ["bot_default", "code_default", "memory_capture", "chat_title", "vision", "classifier"].map(
    (role) => [role, { modelId: null, fallback: true }],
  ),
);

const model = (id: string, overrides: Partial<AccountModel> = {}): AccountModel => ({
  id,
  upstreamId: id,
  name: id.toUpperCase(),
  type: "chat",
  source: "discovered",
  enabled: true,
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  imageInput: false,
  reasoning: false,
  overrides: {},
  compat: null,
  missing: false,
  usedBy: 0,
  ...overrides,
});

const account = (overrides: Partial<Account>): Account => ({
  id: "acc1",
  name: "Anthropic",
  kind: "anthropic",
  baseUrl: "https://api.anthropic.com",
  viaProviderId: null,
  settings: {},
  discovery: "auto",
  allowPrivateNetwork: false,
  enabled: true,
  status: "ok",
  statusDetail: null,
  checkedAt: "2026-11-05T10:00:00.000Z",
  version: 1,
  credential: { hint: "sk-…a1B2", backend: "local" },
  models: [],
  ...overrides,
});

const ACCOUNTS: Account[] = [
  account({
    models: [
      model("claude-a", { imageInput: true, reasoning: true, usedBy: 2 }),
      model("claude-b", { enabled: false, missing: true, usedBy: 1 }),
      model("guard", { type: "classifier" }),
    ],
  }),
  account({
    id: "gw",
    name: "Gateway",
    kind: "cloudflare-ai-gateway",
    baseUrl: null,
    status: "key_rejected",
    statusDetail: "401 from the gateway",
    checkedAt: null,
    settings: { customProviders: [{ slug: "custom-zai", basePath: "" }] },
    models: [model("custom-zai/glm"), model("custom-other/x"), model("openai/gpt")],
  }),
  account({
    id: "via",
    name: "Through gateway",
    kind: "openai-chat",
    viaProviderId: "gw",
    credential: null,
    enabled: false,
    status: "unchecked",
    models: [],
  }),
  account({
    id: "plan",
    name: "Claude plan",
    kind: "claude-plan",
    baseUrl: null,
    credential: null,
    settings: { fallbackModelId: "claude-a", maxTurns: 40 },
    models: [model("opus")],
  }),
  account({
    id: "local",
    name: "Local",
    kind: "openai-chat",
    baseUrl: "http://localhost:11434/v1",
    allowPrivateNetwork: true,
    status: "unreachable",
    models: [model("llama")],
  }),
  account({ id: "faux", name: "Faux", kind: "faux", baseUrl: null, credential: null }),
];

function load(accounts: Account[] = ACCOUNTS, roles: Record<string, unknown> = ROLES) {
  api.accounts.mockResolvedValue({ accounts, templates: TEMPLATES });
  api.roles.mockResolvedValue({ roles });
}

async function mount() {
  const result = render(
    <AppQueryProvider>
      <ConfirmProvider>
        <ModelsSettings />
      </ConfirmProvider>
    </AppQueryProvider>,
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return result;
}

function pin(name?: string) {
  expect(outline(document.body)).toMatchSnapshot(name ? `${name} outline` : "outline");
  expect(markup(document.body)).toMatchSnapshot(name ? `${name} markup` : "markup");
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

const user = userEvent.setup();

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.available.mockResolvedValue({
    models: [
      {
        upstreamId: "claude-c",
        name: "Claude C",
        type: "chat",
        contextWindow: 100_000,
        maxOutputTokens: 8_000,
        imageInput: false,
        reasoning: false,
        known: true,
      },
    ],
  });
});

const dialogShown = () =>
  waitFor(() => {
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.style.opacity).toBe("1");
    const overlays = document.querySelectorAll<HTMLElement>('[data-slot="alert-dialog-overlay"]');
    expect(overlays.length).toBeGreaterThan(0);
    for (const el of overlays) expect(el.style.opacity).toBe("1");
  });

describe("Settings → Models, pinned", () => {
  it("while loading", async () => {
    api.accounts.mockReturnValue(new Promise(() => {}));
    api.roles.mockReturnValue(new Promise(() => {}));
    await mount();
    pin();
  });

  it("with nothing set up", async () => {
    load([]);
    await mount();
    await screen.findByText("No model is set up");
    pin();
  });

  it("with only the faux account", async () => {
    load([ACCOUNTS[5]!]);
    await mount();
    await screen.findByText("No model is set up");
    pin();
  });

  it("with accounts of each kind, folded, and default models set", async () => {
    load(ACCOUNTS, {
      ...ROLES,
      bot_default: { modelId: "claude-a", fallback: false },
      chat_title: { modelId: "claude-a", fallback: true },
      vision: { modelId: "gone", fallback: true },
      classifier: { modelId: "guard", fallback: false },
    });
    await mount();
    await screen.findByText("Default models");
    pin();
  });

  it.each(["Anthropic", "Gateway", "Through gateway", "Claude plan", "Local", "Faux"])(
    "the %s card open",
    async (name) => {
      load();
      await mount();
      await screen.findByText("Default models");
      await user.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(api.available).toHaveBeenCalled());
      await settle();
      pin();
    },
  );

  it("max turns: invalid, then no limit", async () => {
    load();
    await mount();
    await screen.findByText("Default models");
    await user.click(screen.getByRole("button", { name: "Claude plan" }));
    const input = screen.getByLabelText("Max turns");
    await user.clear(input);
    await user.type(input, "5000");
    pin("invalid");
    load(
      ACCOUNTS.map((a) =>
        a.id === "plan" ? { ...a, settings: { ...a.settings, maxTurns: "unlimited" } } : a,
      ),
    );
    api.patch.mockResolvedValue({});
    await user.click(screen.getByRole("checkbox", { name: "No limit" }));
    await waitFor(() => expect(screen.getByLabelText("Max turns")).toBeDisabled());
    pin("unlimited");
  });

  it.each([
    ["Anthropic", "Anthropic"],
    ["Gateway", "Gateway"],
    ["Through gateway", "Through gateway"],
    ["Local", "Local"],
  ])("the edit dialog for %s", async (_label, name) => {
    load();
    await mount();
    await screen.findByText("Default models");
    const title = screen.getByRole("button", { name });
    const card = title.closest("[data-slot=card]") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog");
    pin();
  });

  it("deleting a model in use asks which takes over", async () => {
    load();
    api.removeModel.mockRejectedValue(
      new ApiError({
        status: 409,
        code: "CONFLICT",
        message: "in use",
        url: "/models",
        details: { in_use: { bots: [{ name: "Ada" }, { name: "Bo" }], roles: ["vision"] } },
      }),
    );
    await mount();
    await screen.findByText("Default models");
    await user.click(screen.getByRole("button", { name: "Anthropic" }));
    await user.click(screen.getByRole("button", { name: "Delete CLAUDE-A" }));
    await dialogShown();
    pin("confirm");
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await screen.findByText("CLAUDE-A is in use");
    await settle();
    pin("move");
  });
});
