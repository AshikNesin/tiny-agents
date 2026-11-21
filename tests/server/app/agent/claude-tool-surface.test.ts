import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { claudeToolSurface } from "../../../../packages/agent/src/engines/claude-code/tools";
import { createToolSearchCapability } from "../../../../packages/agent/src/capabilities";
import { defineToolkit, tool } from "../../../../packages/agent/src/toolkit";
import { createQuestionsCapability } from "../../../../packages/agent/src/toolkits/questions";
import { WaitTracker } from "../../../../packages/agent/src/waiting";
import {
  createSdkQueryFactory,
  type ClaudeSdkModule,
} from "../../../../packages/claude-worker/src/index";

const ok = async () => ({ output: [{ type: "text" as const, text: "ok" }] });

function deskToolkit(configured: boolean) {
  return defineToolkit({
    id: "desk",
    name: "Desk",
    description: "Desk tools",
    tools: [
      tool({
        name: "desk_read",
        label: "Read the desk",
        askLabel: "read the desk",
        summary: "Read the desk",
        description: "Read what is on the desk. Use before moving anything.",
        policy: { readOnly: true },
        parameters: Type.Object({ shelf: Type.String({ description: "Which shelf" }) }),
        execute: ok,
      }),
      tool({
        name: "desk_tidy",
        label: "Tidied the desk",
        askLabel: "tidy the desk",
        summary: "Tidy the desk",
        description: "Tidy the desk.",
        parameters: Type.Object({}),
        execute: ok,
      }),
    ],
    offered: (name) => configured || name === "desk_read",
  });
}

describe("claudeToolSurface", () => {
  it("describes each tool with the text the model reads, not the owner's summary", () => {
    const desk = deskToolkit(true);
    const surface = claudeToolSurface(new Map([[desk.id, desk]]), {
      enabled: ["desk"],
      permissions: {},
    });
    expect(surface.tools.find((t) => t.name === "desk_read")?.description).toBe(
      "Read what is on the desk. Use before moving anything.",
    );
  });

  it("leaves ask_owner out where nobody can answer, and keeps it in chats", () => {
    const questions = createQuestionsCapability(new WaitTracker());
    const catalog = new Map([[questions.id, questions]]);
    const names = (unattended: boolean) =>
      claudeToolSurface(catalog, {
        enabled: [questions.id],
        permissions: {},
        ...(unattended ? { unattended: true } : {}),
      }).tools.map((t) => t.name);
    expect(names(false)).toEqual(["ask_owner", "message_owner"]);
    expect(names(true)).toEqual(["message_owner"]);
  });

  it("leaves out tools the toolkit does not offer the model", () => {
    const desk = deskToolkit(false);
    const surface = claudeToolSurface(new Map([[desk.id, desk]]), {
      enabled: ["desk"],
      permissions: {},
    });
    expect(surface.tools.map((t) => t.name)).toEqual(["desk_read"]);
  });

  it("offers deferred tools directly and leaves out tool_search, which needs the pi runtime", () => {
    const desk = deskToolkit(true);
    const search = createToolSearchCapability();
    const surface = claudeToolSurface(
      new Map([
        [desk.id, desk],
        [search.id, search],
      ]),
      { enabled: ["desk", "tool-search"], permissions: {} },
    );
    expect(surface.tools.map((t) => t.name)).toEqual(["desk_read", "desk_tidy"]);
  });
});

describe("Claude plan tool parameters", () => {
  it("keeps each parameter's description and a string enum's or literal union's values", async () => {
    const shapes: Record<string, z.ZodType>[] = [];
    const sdk: ClaudeSdkModule = {
      query: () => (async function* () {})(),
      tool: (name, _description, shape) => {
        shapes.push(shape as Record<string, z.ZodType>);
        return { name };
      },
      createSdkMcpServer: (opts) => ({ name: opts.name }),
    };
    await createSdkQueryFactory(sdk, { PATH: "/usr/bin" })({
      model: "claude-sonnet-4-6",
      system: "",
      tools: [
        {
          name: "desk_read",
          description: "Read the desk",
          inputSchema: {
            type: "object",
            properties: {
              shelf: { type: "string", description: "Which shelf" },
              side: { type: "string", enum: ["left", "right"] },
              button: {
                anyOf: [
                  { const: "left", type: "string" },
                  { const: "middle", type: "string" },
                ],
              },
            },
            required: ["shelf"],
          },
        },
      ],
      signal: new AbortController().signal,
      turns: (async function* () {})(),
      publish: () => undefined,
      callTool: async () => ({ content: "" }),
      setClaudeSessionId: () => undefined,
    });
    const shape = z.object(shapes[0]!);
    expect(shape.shape.shelf.description).toBe("Which shelf");
    expect(shape.safeParse({ shelf: "top", side: "up" }).success).toBe(false);
    expect(shape.safeParse({ shelf: "top", side: "left" }).success).toBe(true);
    expect(shape.safeParse({ shelf: "top", button: "right" }).success).toBe(false);
    expect(shape.safeParse({ shelf: "top", button: "middle" }).success).toBe(true);
  });
});
