/**
 * The `vault` toolkit (issue #56): `vault_list` shows the bot which of the
 * owner's vault items it may use, by handle and metadata only. The sink tools
 * that actually use an item live with their sinks (`browser_fill_secret`,
 * `browser_enter_code` in the browser toolkit, `http_request` in web) and
 * share the gate plan below.
 */
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  type JsonObject,
  type ToolExecutionApi,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import type { GateHooks, GatePlan } from "../approvals";
import type { Capability } from "../capabilities";
import {
  hasGrant,
  VAULT_RULE,
  vaultGrant,
  VaultError,
  type VaultBroker,
  type VaultItemMeta,
  type VaultUse,
} from "../vault";

/** A vault approval nobody answers fails closed after this long. */
export const VAULT_APPROVAL_TTL_MS = 10 * 60_000;

export interface VaultToolkitOptions {
  /** The app's broker. Without one the toolkit offers no tools. */
  broker?: VaultBroker;
}

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

/** One item as the model reads it. */
export function describeItem(item: VaultItemMeta): string {
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

/**
 * The gate plan of a vault sink: the broker's policy decides refusals and
 * whether the owner must approve; a tool permission of `ask` asks too unless
 * the owner granted the handle for the conversation.
 */
export function vaultGatePlan<TArgs>(
  broker: VaultBroker,
  /** A call that names no item asks per the tool's permission (`false`: never). */
  askWithoutUse: boolean,
  /** The use this call intends, or a refusal; `undefined`: no vault item involved. */
  useOf: (
    args: TArgs,
    api: ToolExecutionApi,
    context: Context,
  ) => Promise<Omit<VaultUse, "granted" | "conversation"> | { refuse: string } | undefined>,
): GateHooks<TArgs> {
  const resolveUse = async (args: TArgs, api: ToolExecutionApi, context: Context) => {
    const intended = await useOf(args, api, context);
    if (!intended || "refuse" in intended) return intended;
    const use: VaultUse = {
      ...intended,
      conversation: Number(api.conversationId),
      granted: await hasGrant(api, vaultGrant(intended.handle), context),
    };
    return use;
  };
  return {
    async plan(args, api, context, toolAsks): Promise<GatePlan> {
      let use: Awaited<ReturnType<typeof resolveUse>>;
      try {
        use = await resolveUse(args, api, context);
      } catch (error) {
        // Planning runs before any value is resolved: its errors (no page
        // open, a browser that can't fill) are safe to show as they are.
        return {
          refuse: error instanceof Error ? error.message : safeMessage(error),
          ask: false,
        };
      }
      if (!use) return { ask: askWithoutUse && toolAsks };
      if ("refuse" in use) return { refuse: use.refuse, ask: false };
      // The use this call was planned for: what a denial is audited against.
      await api.memo("vault:use", use as unknown as JsonObject, context);
      const plan = await broker.plan(use);
      if (plan.refused) return { refuse: plan.message, ask: false };
      const ask = plan.approve || (toolAsks && !use.granted);
      if (!ask) return { ask: false };
      return {
        ask: true,
        details: {
          vault: { ...plan.card, grantable: plan.grantable } as unknown as JsonObject,
        },
        ...(plan.grantable ? { grant: vaultGrant(use.handle) } : {}),
        expiresInMs: VAULT_APPROVAL_TTL_MS,
      };
    },
    async settled(_args, api, context, decision) {
      const use = await api.memo<JsonObject>("vault:use", context);
      if (use) await broker.record(use as unknown as VaultUse, decision);
    },
  };
}

/** A fixed message for a failed vault use: never a raw backend or page error. */
export function safeMessage(error: unknown): string {
  if (error instanceof VaultError) return error.message;
  return "The vault use failed.";
}

export function createVaultToolkit(options: VaultToolkitOptions = {}): Capability {
  const broker = options.broker;
  const vaultList = defineTool({
    name: "vault_list",
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

  return {
    id: "vault",
    kind: "toolkit",
    name: "Vault",
    description: "Uses your saved logins, cards and API keys without seeing them",
    extension: defineExtension({ name: "vault", tools: broker ? [vaultList] : [] }),
    tools: [
      {
        name: "vault_list",
        label: "Listed vault items",
        description: "List the vault items the bot may use (handles only)",
        readOnly: true,
      },
    ],
    ...(broker ? {} : { setupHint: "Configure the vault (see docs/features/vault.md)." }),
  };
}
