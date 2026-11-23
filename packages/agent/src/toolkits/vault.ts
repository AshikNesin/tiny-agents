import type { Context } from "@earendil-works/chord/context";
import { Type } from "typebox";
import type { JsonObject, ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { z } from "zod";
import { gateApproved, type GateHooks, type GatePlan } from "../approvals";
import type { Capability } from "../capabilities";
import { durableMemo, toJson } from "../durable-json";
import { defineToolkit, tool } from "../toolkit";
import {
  hasGrant,
  VAULT_RULE,
  VAULT_TARGET_KINDS,
  vaultGrant,
  VaultError,
  VaultTargetMovedError,
  type SecretField,
  type SecretValues,
  type VaultBroker,
  type VaultCard,
  type VaultItemMeta,
  type VaultPlan,
  type VaultUse,
} from "../vault";

const VAULT_APPROVAL_TTL_MS = 10 * 60_000;

export interface VaultToolkitOptions {
  broker?: VaultBroker;
}

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

function describeItem(item: VaultItemMeta): string {
  const lines = [`- ${item.handle} (${item.kind}): ${item.label}`];
  if (item.username) lines.push(`  username: ${item.username}`);
  if (item.origins.length > 0) lines.push(`  fills on: ${item.origins.join(", ")}`);
  if (item.allowedHosts.length > 0) lines.push(`  sends to: ${item.allowedHosts.join(", ")}`);
  if (item.card) lines.push(`  card: ${item.card.brand} ending ${item.card.last4}`);
  if (item.hasTotp) lines.push("  one-time codes: yes (browser_enter_code)");
  if (item.tools.length > 0) lines.push(`  tools: ${item.tools.join(", ")}`);
  if (item.whenToUse) lines.push(`  when to use: ${item.whenToUse}`);
  return lines.join("\n");
}

export type IntendedUse = Omit<VaultUse, "granted" | "conversation">;

export interface IntendedUses {
  uses: readonly IntendedUse[];
  everyUse?: boolean;
  confine?: () => { refuse: string; reason: string } | undefined;
  card?: JsonObject;
}

const CARD_TARGET_CHARS = 20_000;

const vaultUse = z.object({
  handle: z.string(),
  tool: z.string(),
  targetKind: z.enum(VAULT_TARGET_KINDS),
  target: z.string(),
  conversation: z.number(),
  granted: z.boolean(),
});

const plannedMemo = durableMemo<VaultUse | { uses: VaultUse[] }>(
  "vault:use",
  z.union([vaultUse, z.object({ uses: z.array(vaultUse) })]),
);

async function plannedUses(api: ToolExecutionApi, context: Context): Promise<VaultUse[]> {
  const memo = await plannedMemo.read(api, context);
  return !memo ? [] : "uses" in memo ? memo.uses : [memo];
}

async function withGrants(
  intended: readonly IntendedUse[],
  api: ToolExecutionApi,
  context: Context,
): Promise<VaultUse[]> {
  const uses: VaultUse[] = [];
  for (const use of intended) {
    uses.push({
      ...use,
      conversation: Number(api.conversationId),
      granted: await hasGrant(api, vaultGrant(use.handle), context),
    });
  }
  return uses;
}

function cardOf(cards: readonly VaultCard[]): VaultCard {
  const [first] = cards;
  const card: VaultCard =
    cards.length === 1
      ? { ...first }
      : {
          handle: cards.map((c) => c.handle).join(", "),
          label: cards.map((c) => c.label).join(", "),
          kind: first.kind,
          tool: first.tool,
          target: first.target,
          ...(first.bot ? { bot: first.bot } : {}),
        };
  if (card.target.length > CARD_TARGET_CHARS) {
    card.target = `${card.target.slice(0, CARD_TARGET_CHARS)}…`;
  }
  return card;
}

export function vaultGatePlan<TArgs>(
  broker: VaultBroker,
  askWithoutUse: boolean,
  useOf: (
    args: TArgs,
    api: ToolExecutionApi,
    context: Context,
  ) => Promise<IntendedUse | IntendedUses | { refuse: string } | undefined>,
): GateHooks<TArgs> {
  return {
    async plan(args, api, context, toolAsks): Promise<GatePlan> {
      let intended: IntendedUses | { refuse: string } | undefined;
      let uses: VaultUse[] = [];
      try {
        const of = await useOf(args, api, context);
        intended = !of || "refuse" in of || "uses" in of ? of : { uses: [of] };
        if (intended && "uses" in intended) uses = await withGrants(intended.uses, api, context);
      } catch (error) {
        return {
          refuse: error instanceof Error ? error.message : safeMessage(error),
          ask: false,
        };
      }
      if (intended && "refuse" in intended) return { refuse: intended.refuse, ask: false };
      if (!intended || uses.length === 0) return { ask: askWithoutUse && toolAsks };
      await plannedMemo.keep(api, uses.length === 1 ? uses[0] : { uses }, context);
      const plans: Exclude<VaultPlan, { refused: string }>[] = [];
      for (const use of uses) {
        const plan = await broker.plan(use);
        if (plan.refused) return { refuse: plan.message, ask: false };
        plans.push(plan);
      }
      const confined = intended.confine?.();
      if (confined) {
        for (const use of uses) await broker.record(use, "refused_policy", confined.reason);
        return { refuse: confined.refuse, ask: false };
      }
      const ask =
        intended.everyUse === true ||
        plans.some((plan) => plan.approve) ||
        (toolAsks && !uses.every((use) => use.granted));
      if (!ask) return { ask: false };
      const grantable = !intended.everyUse && plans.length === 1 && plans[0].grantable;
      return {
        ask: true,
        details: {
          vault: toJson({ ...cardOf(plans.map((plan) => plan.card)), ...intended.card, grantable }),
        },
        ...(grantable ? { grant: vaultGrant(uses[0].handle) } : {}),
        expiresInMs: VAULT_APPROVAL_TTL_MS,
      };
    },
    async settled(_args, api, context, decision) {
      for (const use of await plannedUses(api, context)) await broker.record(use, decision);
    },
  };
}

const MOVED = (actual: string) =>
  `The target is now ${actual}, not the one this call was approved for. Nothing was used.`;

export async function vaultUseFromSink<T>(
  broker: VaultBroker,
  api: ToolExecutionApi,
  context: Context,
  intended: IntendedUse,
  fields: readonly SecretField[] | ((item: VaultItemMeta) => readonly SecretField[]),
  sink: (values: SecretValues, item: VaultItemMeta) => Promise<T>,
  moved: (actual: string) => string = MOVED,
): Promise<T> {
  return vaultUseAllFromSink(
    broker,
    api,
    context,
    [intended],
    fields,
    ([values], [item]) => sink(values, item),
    moved,
  );
}

export async function vaultUseAllFromSink<T>(
  broker: VaultBroker,
  api: ToolExecutionApi,
  context: Context,
  intended: readonly IntendedUse[],
  fields: readonly SecretField[] | ((item: VaultItemMeta) => readonly SecretField[]),
  sink: (values: SecretValues[], items: VaultItemMeta[]) => Promise<T>,
  moved: (actual: string) => string = MOVED,
): Promise<T> {
  const uses = await withGrants(intended, api, context);
  const planned = await plannedUses(api, context);
  const changed = uses.find((use, i) => planned[i]?.target && planned[i].target !== use.target);
  if (changed) {
    for (const use of uses) {
      await broker.record(use, "refused_origin", "target moved after planning");
    }
    throw new VaultError("refused_origin", moved(changed.target));
  }
  const approved = await gateApproved(api, context);
  const step = (index: number, values: SecretValues[], items: VaultItemMeta[]): Promise<T> =>
    index === uses.length
      ? sink(values, items)
      : broker.use({ ...uses[index], approved }, fields, (resolved, item) =>
          step(index + 1, [...values, resolved], [...items, item]),
        );
  try {
    return await step(0, [], []);
  } catch (error) {
    if (error instanceof VaultTargetMovedError) {
      throw new VaultError("refused_origin", moved(error.actual));
    }
    throw error;
  }
}

export function safeMessage(error: unknown): string {
  if (error instanceof VaultError) return error.message;
  return "The vault use failed.";
}

export function createVaultToolkit(options: VaultToolkitOptions = {}): Capability {
  const broker = options.broker;
  const vaultList = tool({
    name: "vault_list",
    label: "Listed vault items",
    askLabel: "list vault items",
    summary: "List the vault items the bot may use (handles only)",
    policy: { readOnly: true },
    description:
      "List the owner's vault items you may use: logins, cards and API keys, by handle. " +
      "Pass a handle to browser_fill_secret, browser_enter_code or http_request (auth) to use one; " +
      "the value goes straight into the page or request and you never see it. " +
      VAULT_RULE,
    parameters: Type.Object({
      tool: Type.Optional(
        Type.String({ maxLength: 64, description: "Only items this tool may use" }),
      ),
      origin: Type.Optional(
        Type.String({
          maxLength: 300,
          description: "Only items that fill on this origin (https://github.com)",
        }),
      ),
    }),
    replay: "safe",
    execute: async (args, api) => {
      if (!broker) return fail("The vault is not configured.");
      try {
        const items = await broker.list({
          conversation: Number(api.conversationId),
          ...(args.tool ? { tool: args.tool } : {}),
          ...(args.origin ? { origin: args.origin } : {}),
        });
        if (items.length === 0) {
          return {
            output: [
              {
                type: "text",
                text: "No vault items you may use. Ask the owner to add one on the Vault page, or use request_credentials on a sign-in page.",
              },
            ],
          };
        }
        return {
          output: [{ type: "text", text: items.map(describeItem).join("\n") }],
          details: { handles: items.map((item) => item.handle) },
        };
      } catch (error) {
        return fail(safeMessage(error));
      }
    },
  });

  return defineToolkit({
    id: "vault",
    deferred: true,
    name: "Vault",
    description: "Uses your saved logins, cards and API keys without seeing them",
    tools: [vaultList],
    offered: () => Boolean(broker),
    ...(broker ? {} : { setupHint: "Configure the vault (see docs/features/vault.md)." }),
  });
}
