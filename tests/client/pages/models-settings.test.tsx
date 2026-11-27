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
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { ModelsSettings } from "@/pages/settings/models/ModelsSettings";
import { vaultApi } from "@/lib/vault-api";
import { ConfirmProvider } from "@groot/ui/primitives";
import type { Deleted } from "../../../apps/web/src/shared/api/common";
import type {
  Account,
  AccountList,
  AccountModel,
  DiscoveredModel,
  DiscoveredModels,
  ModelsResponse,
  ProviderTemplate,
  RolesResponse,
} from "../../../apps/web/src/shared/api/models";
import type { StepUpToken } from "../../../apps/web/src/shared/api/vault";
import { FIXED_NOW } from "../../test-clock";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

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

const unset = { modelId: null, fallback: true };
const ROLES: RolesResponse = {
  roles: {
    bot_default: unset,
    code_default: unset,
    memory_capture: unset,
    chat_title: unset,
    vision: unset,
    classifier: unset,
  },
};
const CATALOG: ModelsResponse = {
  models: [],
  defaultModelId: null,
  canAnswer: false,
  providers: [],
};
const STEP_UP: StepUpToken = {
  token: "step-up-token",
  expiresAt: Date.parse(FIXED_NOW) + 10 * 60_000,
};

const found = (upstreamId: string, name: string): DiscoveredModel => ({
  upstreamId,
  name,
  type: "chat",
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
  imageInput: true,
  reasoning: true,
  compat: null,
  known: true,
});

let api: ReturnType<typeof fakeApi>;

const accountsAre = (accounts: Account[]) =>
  api.get("/models/providers", (): AccountList => ({ accounts, templates: TEMPLATES }));
const discovers = (models: DiscoveredModel[]) =>
  api.post("/models/discover", (): DiscoveredModels => ({ models }));
const deletions = () => api.requests.filter((request) => request.method === "DELETE");

beforeEach(async () => {
  api = fakeApi();
  accountsAre([]);
  api.get("/models/roles", () => ROLES);
  api.get("/models", () => CATALOG);
  api.get("/models/providers/:id/available", (): DiscoveredModels => ({ models: [] }));
  api.post("/vault/step-up", () => STEP_UP);
  await vaultApi.confirmWithPassword("correct horse");
});

describe("Settings → Models", () => {
  it("offers templates when nothing is set up, then connects the models the owner keeps", async () => {
    discovers([
      found("claude-sonnet-4-6", "Claude Sonnet 4.6"),
      found("claude-haiku-4-5", "Claude Haiku 4.5"),
    ]);
    api.post("/models/providers", () => ({ ...account([]), id: "a1" }));
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

    await user.click(await within(dialog).findByRole("checkbox", { name: "Claude Haiku 4.5" }));
    expect(api.sent("POST", "/models/discover")[0]!.body).toEqual(
      expect.objectContaining({
        kind: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-api-test",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(api.sent("POST", "/models/providers")).toHaveLength(1));
    const created = api.sent("POST", "/models/providers")[0]!;
    expect(created.body).toEqual(
      expect.objectContaining({
        kind: "anthropic",
        name: "Anthropic",
        discovery: "auto",
        models: ["claude-sonnet-4-6"],
      }),
    );
    expect(created.headers.get("X-Vault-Step-Up")).toBe(STEP_UP.token);
  });

  it("starts an aggregator's list with nothing checked", async () => {
    discovers([found("a/one", "One"), found("b/two", "Two")]);
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

function account(models: Partial<AccountModel>[]): Account {
  return {
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
  };
}

describe("Settings → Models · delete", () => {
  beforeEach(() => {
    accountsAre([
      account([
        { id: "m1", upstreamId: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
        { id: "m2", upstreamId: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      ]),
    ]);
    api.delete("/models/:id", (): Deleted => ({ deleted: true }));
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
    expect(deletions()).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.sent("DELETE", "/models/m1")).toHaveLength(1));
    expect(api.sent("DELETE", "/models/m1")[0]!.query.has("moveTo")).toBe(false);
  });

  it("keeps the model when the owner cancels", async () => {
    const user = userEvent.setup();
    await openModels(user);
    await user.click(await screen.findByRole("button", { name: "Delete Claude Haiku 5.5" }));

    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deletions()).toEqual([]);
  });

  it("warns which bots use a model before deleting it", async () => {
    accountsAre([
      account([
        { id: "m1", upstreamId: "claude-haiku-5-5", name: "Claude Haiku 5.5", usedBy: 2 },
        { id: "m2", upstreamId: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      ]),
    ]);
    const user = userEvent.setup();
    await openModels(user);
    await user.click(await screen.findByRole("button", { name: "Delete Claude Haiku 5.5" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/^2 bots use it\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(deletions()).toEqual([]);
  });
});

describe("Settings → Models · account summary", () => {
  it("says when the account was last checked as a relative time", async () => {
    accountsAre([{ ...account([{}]), checkedAt: "2026-11-06T05:30:00.000Z" }]);
    render(
      <AppQueryProvider>
        <ConfirmProvider>
          <ModelsSettings />
        </ConfirmProvider>
      </AppQueryProvider>,
    );

    expect(
      await screen.findByText(
        "Anthropic · api.anthropic.com · sk-…a1B2 · Local · 1 model · checked an hour ago",
      ),
    ).toBeTruthy();
  });

  it("names 1Password as the key's vault", async () => {
    accountsAre([
      {
        ...account([{}]),
        checkedAt: "2026-11-06T05:30:00.000Z",
        credential: { hint: "sk-…a1B2", backend: "onepassword" },
      },
    ]);
    render(
      <AppQueryProvider>
        <ConfirmProvider>
          <ModelsSettings />
        </ConfirmProvider>
      </AppQueryProvider>,
    );

    expect(
      await screen.findByText(
        "Anthropic · api.anthropic.com · sk-…a1B2 · 1Password · 1 model · checked an hour ago",
      ),
    ).toBeTruthy();
  });
});
