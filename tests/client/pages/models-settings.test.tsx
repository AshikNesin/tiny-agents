/**
 * @vitest-environment jsdom
 *
 * Settings → Models (issue #179): an owner with no model picks a template,
 * checks which models the endpoint lists, and connects the ones they keep.
 * Step-up is fresh here; the step-up prompt has its own suite.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ModelsSettings } from "@/pages/settings/models/ModelsSettings";
import { ConfirmProvider } from "@groot/ui/primitives";
import type {
  Account,
  AccountModel,
  ProviderTemplate,
} from "../../../apps/web/src/shared/api/models";
import { AppQueryProvider } from "../query-provider";

const api = vi.hoisted(() => ({
  accounts: vi.fn(),
  roles: vi.fn(),
  discover: vi.fn(),
  available: vi.fn(),
  create: vi.fn(),
  removeModel: vi.fn(),
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
  ["bot_default", "memory_capture", "chat_title", "vision", "classifier"].map((role) => [
    role,
    { modelId: null, fallback: true },
  ]),
);

const found = (upstreamId: string, name: string) => ({
  upstreamId,
  name,
  type: "chat",
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  imageInput: true,
  reasoning: true,
  known: true,
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.accounts.mockResolvedValue({ accounts: [] as Account[], templates: TEMPLATES });
  api.roles.mockResolvedValue({ roles: ROLES });
  api.available.mockResolvedValue({ models: [] });
});

describe("Settings → Models", () => {
  it("offers templates when nothing is set up, then connects the models the owner keeps", async () => {
    api.discover.mockResolvedValue({
      models: [
        found("claude-sonnet-4-6", "Claude Sonnet 4.6"),
        found("claude-haiku-4-5", "Claude Haiku 4.5"),
      ],
    });
    api.create.mockResolvedValue({ id: "a1", name: "Anthropic" });
    const user = userEvent.setup();
    render(
      <AppQueryProvider>
        <ModelsSettings />
      </AppQueryProvider>,
    );

    expect(await screen.findByText("No model is set up")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Anthropic" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Endpoint")).toHaveValue("https://api.anthropic.com");
    await user.type(within(dialog).getByLabelText("API key"), "sk-ant-api-test");
    await user.click(within(dialog).getByRole("button", { name: "Check models" }));

    expect(api.discover).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-api-test",
      }),
    );
    await user.click(await within(dialog).findByRole("checkbox", { name: "Claude Haiku 4.5" }));
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "anthropic",
          name: "Anthropic",
          discovery: "auto",
          models: ["claude-sonnet-4-6"],
        }),
      ),
    );
  });

  it("starts an aggregator's list with nothing checked", async () => {
    api.discover.mockResolvedValue({
      models: [found("a/one", "One"), found("b/two", "Two")],
    });
    const user = userEvent.setup();
    render(
      <AppQueryProvider>
        <ModelsSettings />
      </AppQueryProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "OpenRouter" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("API key"), "sk-or-test");
    await user.click(within(dialog).getByRole("button", { name: "Check models" }));
    expect(await within(dialog).findByText("0 of 2 selected")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Connect" })).toBeDisabled();
  });
});

const account = (models: Partial<AccountModel>[]): Account => ({
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
  checkedAt: "2026-11-08T10:00:00.000Z",
  version: 1,
  credential: { hint: "sk-…a1B2", backend: "local" },
  models: models.map((model, index) => ({
    id: `m${index + 1}`,
    upstreamId: `claude-${index + 1}`,
    name: `Claude ${index + 1}`,
    type: "chat",
    source: "discovered",
    enabled: true,
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    imageInput: true,
    reasoning: true,
    overrides: {},
    compat: null,
    missing: false,
    usedBy: 0,
    ...model,
  })),
});

describe("Settings → Models · delete", () => {
  beforeEach(() => {
    api.accounts.mockResolvedValue({
      accounts: [
        account([
          { id: "m1", upstreamId: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
          { id: "m2", upstreamId: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
        ]),
      ],
      templates: TEMPLATES,
    });
    api.removeModel.mockResolvedValue({ deleted: true });
  });

  const openModels = async (user: ReturnType<typeof userEvent.setup>) => {
    render(
      <AppQueryProvider>
        <ConfirmProvider>
          <ModelsSettings />
        </ConfirmProvider>
      </AppQueryProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Anthropic" }));
  };

  it("deletes a model only after the owner confirms", async () => {
    const user = userEvent.setup();
    await openModels(user);
    await user.click(await screen.findByRole("button", { name: "Delete Claude Haiku 5.5" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete Claude Haiku 5.5?")).toBeInTheDocument();
    expect(api.removeModel).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.removeModel).toHaveBeenCalledWith("m1", undefined));
  });

  it("keeps the model when the owner cancels", async () => {
    const user = userEvent.setup();
    await openModels(user);
    await user.click(await screen.findByRole("button", { name: "Delete Claude Haiku 5.5" }));

    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(api.removeModel).not.toHaveBeenCalled();
  });

  it("warns which bots use a model before deleting it", async () => {
    api.accounts.mockResolvedValue({
      accounts: [
        account([
          { id: "m1", upstreamId: "claude-haiku-5-5", name: "Claude Haiku 5.5", usedBy: 2 },
          { id: "m2", upstreamId: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
        ]),
      ],
      templates: TEMPLATES,
    });
    const user = userEvent.setup();
    await openModels(user);
    await user.click(await screen.findByRole("button", { name: "Delete Claude Haiku 5.5" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/^2 bots use it\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.removeModel).not.toHaveBeenCalled();
  });
});

describe("Settings → Models · account summary", () => {
  it("says when the account was last checked as a relative time", async () => {
    api.accounts.mockResolvedValue({
      accounts: [{ ...account([{}]), checkedAt: "2026-11-06T05:30:00.000Z" }],
      templates: TEMPLATES,
    });
    render(
      <AppQueryProvider>
        <ConfirmProvider>
          <ModelsSettings />
        </ConfirmProvider>
      </AppQueryProvider>,
    );

    expect(
      await screen.findByText(
        "Anthropic · api.anthropic.com · sk-…a1B2 · local · 1 model · checked an hour ago",
      ),
    ).toBeTruthy();
  });
});
