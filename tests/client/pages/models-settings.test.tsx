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
import type { Account, ProviderTemplate } from "@/lib/models-api";

const api = vi.hoisted(() => ({
  accounts: vi.fn(),
  roles: vi.fn(),
  discover: vi.fn(),
  create: vi.fn(),
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
    render(<ModelsSettings />);

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
    // A direct vendor starts with every model checked; untick one.
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
    render(<ModelsSettings />);
    await user.click(await screen.findByRole("button", { name: "OpenRouter" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("API key"), "sk-or-test");
    await user.click(within(dialog).getByRole("button", { name: "Check models" }));
    expect(await within(dialog).findByText("0 of 2 selected")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Connect" })).toBeDisabled();
  });
});
