import { Type } from "typebox";
import type { JsonObject } from "@earendil-works/pi-durable";
import { tool } from "../toolkit";
import { refuseUnattended, unattendedOnce } from "../waiting";
import type { ComputerDesktop, ComputerToolkitOptions } from "./computer-desktop";
import { fail } from "./result";

export function takeoverTool(desktop: ComputerDesktop, options: ComputerToolkitOptions) {
  const { sessions, profileOf, unavailable, describe, image } = desktop;
  const takeoverWaitMs = options.takeoverWaitMs ?? 15 * 60_000;
  const tracker = options.ownerWaits;
  return tool({
    name: "computer_request_takeover",
    label: "Asked you to take over the computer",
    askLabel: "ask you to take over the computer",
    summary: "Pause and ask you to drive the computer (logins, 2FA, payments).",
    policy: { readOnly: true },
    description:
      "Pause and ask the owner to drive the computer: sign-ins, 2FA, CAPTCHAs, payments, or anything you " +
      "should not do yourself. Say what they should do. This waits until they hand the computer back, " +
      "then returns a screenshot of what they left.",
    parameters: Type.Object({
      reason: Type.String({
        minLength: 1,
        maxLength: 300,
        description: "What the owner should do",
      }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      if (!sessions) return unavailable();
      if (await unattendedOnce(api, context, "computer:unattended")) {
        return refuseUnattended(
          "Nobody can take over the computer here: this is a scheduled routine run. Finish without it and say what was needed.",
        );
      }
      const conversation = Number(api.conversationId);
      const task = Number(api.taskId);
      const profile = await profileOf(conversation);
      const reason = args.reason.replace(/\s+/g, " ").trim();
      await api.details({ takeover: { status: "pending", reason } } as JsonObject, context);
      tracker?.add(conversation, task, {
        tool: "computer_request_takeover",
        preview: reason,
      });
      let outcome: "released" | "timeout";
      try {
        outcome = await sessions.requestTakeover(profile, reason, takeoverWaitMs);
      } catch (error) {
        return fail(describe(error));
      } finally {
        tracker?.remove(conversation, task);
      }
      if (outcome === "timeout") {
        return {
          output: [
            {
              type: "text",
              text: "The owner has not handed the computer back yet. Tell them what you need and stop here.",
            },
          ],
          isError: true,
          details: { takeover: { status: "expired", reason } },
        };
      }
      const live = sessions.get(profile);
      let shot: Buffer | undefined;
      let shotProblem: string | undefined;
      try {
        shot = await live?.desktop.screenshot();
      } catch (error) {
        shotProblem = describe(error);
      }
      return {
        output: [
          {
            type: "text",
            text: shot
              ? "The owner handed the computer back. This is what they left:"
              : `The owner handed the computer back. ${shotProblem ? `The screenshot of what they left failed: ${shotProblem}` : "The desktop is not running, so there is no screenshot of what they left."}`,
          },
          ...(shot ? [image(shot)] : []),
        ],
        details: {
          takeover: { status: "released", reason },
          ...(shot ? { screenshot: true } : {}),
        },
      };
    },
  });
}
