import { Type } from "typebox";
import { VAULT_RULE, VaultError, type VaultBroker } from "../vault";
import { tool } from "../toolkit";
import { DesktopGoneError, type LiveComputer } from "@tiny-agents/sandbox/computer";
import type { ComputerDesktop } from "./computer-desktop";
import { fail } from "./result";
import { safeMessage, vaultUseFromSink, vaultGatePlan } from "./vault";

export function fillSecretTool(desktop: ComputerDesktop, broker: VaultBroker) {
  const { sessions, profileOf, unavailable, dropIfGone, describe } = desktop;
  return tool({
    name: "computer_fill_secret",
    label: "Typed a saved login on the computer",
    askLabel: "type a saved login on the computer",
    summary: "Type a vault login into a desktop window without seeing it.",
    vault: true,
    description:
      "Type a vault login's password (or username) into the focused field of a desktop window, " +
      "without seeing it. Bind it to the window: its class from computer_list_windows " +
      "(e.g. firefox, org.gnome.Evolution) and words of its title. Nothing is typed if another " +
      "window is in front. Click the field first. Every use asks the owner. " +
      VAULT_RULE,
    parameters: Type.Object({
      handle: Type.String({ minLength: 1, maxLength: 64 }),
      window_class: Type.String({ minLength: 1, maxLength: 120 }),
      window_title: Type.Optional(Type.String({ maxLength: 200 })),
      field: Type.Optional(
        Type.Union([Type.Literal("password"), Type.Literal("username")], {
          description: "Default: password",
        }),
      ),
    }),
    replay: "unsafe",
    execute: async (args, api, context) => {
      if (!sessions) return unavailable();
      const profile = await profileOf(Number(api.conversationId));
      let live: LiveComputer | undefined;
      try {
        live = await sessions.actionTurn(profile);
        const desktop = live.desktop;
        const field = args.field ?? "password";
        await vaultUseFromSink(
          broker,
          api,
          context,
          {
            handle: args.handle,
            tool: "computer_fill_secret",
            targetKind: "window",
            target: windowTarget(args.window_class, args.window_title),
          },
          (item) => (item.kind === "login" ? [field] : []),
          async (values) => {
            const value = values[field]?.reveal();
            if (!value) throw new VaultError("missing_field", "That item has no such value.");
            if (/[\r\n\0]/.test(value)) {
              throw new VaultError("missing_field", "A multi-line value can't be typed.");
            }
            await desktop.typeSecret(value, {
              windowClass: args.window_class,
              title: args.window_title,
            });
          },
          (active) =>
            `The active window is ${active || "unknown"}, not the one this secret is bound to. Nothing was typed.`,
        );
        return {
          output: [
            {
              type: "text",
              text: `Typed the ${field} of ${args.handle} into ${args.window_class}. Press Return or click the button to submit.`,
            },
          ],
        };
      } catch (error) {
        dropIfGone(profile, live, error);
        if (error instanceof VaultError) return fail(safeMessage(error));
        return fail(
          error instanceof DesktopGoneError ? describe(error) : "Typing the secret failed.",
        );
      }
    },
    gate: vaultGatePlan<{ handle: string; window_class: string; window_title?: string }>(
      broker,
      false,
      async (args) => ({
        handle: args.handle,
        tool: "computer_fill_secret",
        targetKind: "window",
        target: windowTarget(args.window_class, args.window_title),
      }),
    ),
  });
}

export function windowTarget(windowClass: string, title?: string): string {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  return title?.trim() ? `${clean(windowClass)} — “${clean(title)}”` : clean(windowClass);
}
