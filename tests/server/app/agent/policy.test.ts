import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";
import {
  applyPermissions,
  compilePolicy,
  mustAsk,
  type Permissions,
} from "../../../../packages/agent/src/policy";
import type { Capability, CapabilitySelection } from "../../../../packages/agent/src/capabilities";
import { createContextTrimExtension } from "../../../../packages/agent/src/context-trim";

const tool = (name: string) =>
  defineTool({
    name,
    description: name,
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => ({ output: [] }),
  });

const mail: Capability = {
  id: "mail",
  kind: "toolkit",
  name: "Mail",
  description: "",
  extension: defineExtension({
    name: "mail",
    tools: [
      tool("read_inbox"),
      tool("send_email"),
      tool("save_skill"),
      tool("report_blocked"),
      tool("ask_owner"),
    ],
  }),
  tools: [
    { name: "read_inbox", label: "", description: "", readOnly: true },
    { name: "send_email", label: "", description: "" },
    { name: "save_skill", label: "", description: "", askOnly: true },
    { name: "report_blocked", label: "", description: "", readOnly: true, unattendedOnly: true },
    { name: "ask_owner", label: "", description: "", readOnly: true, chatOnly: true },
  ],
};
const catalog = new Map([[mail.id, mail]]);
const installed = { extension: (id: string) => (id === "mail" ? mail.extension : undefined) };

const compile = (selection: Partial<CapabilitySelection>) =>
  compilePolicy(catalog, { enabled: ["mail"], permissions: {}, ...selection }, installed);

describe("compilePolicy", () => {
  it.each([
    [
      "defaults: read-only allowed, the rest asks",
      {},
      ["read_inbox", "ask_owner"],
      undefined,
      ["report_blocked"],
    ],
    [
      "an explicit allow, an off tool is removed",
      { permissions: { send_email: "allow", read_inbox: "off" } },
      ["send_email", "ask_owner"],
      undefined,
      ["read_inbox", "report_blocked"],
    ],
    [
      "askOnly never resolves to allow",
      { permissions: { save_skill: "allow" } },
      ["read_inbox", "ask_owner"],
      undefined,
      ["report_blocked"],
    ],
    [
      "auto-review lists the asking tools, never askOnly ones",
      { autoReview: true },
      ["read_inbox", "ask_owner"],
      ["send_email"],
      ["report_blocked"],
    ],
    [
      "unattended: review is off, unattended-only tools are offered, chat-only and ask-only ones removed",
      { autoReview: true, unattended: true },
      ["read_inbox", "report_blocked"],
      undefined,
      ["save_skill", "ask_owner"],
    ],
  ] as const)("%s", (_case, selection, allow, review, removed) => {
    const selected: Partial<CapabilitySelection> = selection;
    const policy = compile(selected);
    expect(policy.permissions.allow).toEqual(allow);
    expect(policy.permissions.review).toEqual(review);
    expect(policy.remove.map((t) => t.name)).toEqual(removed);
    expect(policy.extensions).toEqual([mail.extension]);
    expect(policy.permissions.unattended).toBe(selected.unattended ? true : undefined);
  });

  it("selects the installed context trim for every conversation, whatever it enabled", () => {
    const trim = createContextTrimExtension();
    const policy = compilePolicy(
      catalog,
      { enabled: ["mail"], permissions: {} },
      {
        extension: (id) =>
          id === "context-trim" ? trim : id === "mail" ? mail.extension : undefined,
      },
    );
    expect(policy.extensions.map((extension) => extension.name)).toEqual(["context-trim", "mail"]);
  });

  it("ignores capabilities that are not in the catalog or not installed", () => {
    const policy = compilePolicy(
      catalog,
      { enabled: ["mail", "ghost"], permissions: {} },
      { extension: () => undefined },
    );
    expect(policy.extensions).toEqual([]);
    expect(policy.remove).toEqual([]);
    expect(policy.permissions.allow).toEqual(["read_inbox", "ask_owner"]);
  });

  it("applyPermissions writes and clears the optional fields", () => {
    const doc: { allow: string[]; review?: string[]; unattended?: boolean } = {
      allow: [],
      review: ["x"],
      unattended: true,
    };
    applyPermissions(doc, { allow: ["a"] });
    expect(doc).toEqual({ allow: ["a"] });
    applyPermissions(doc, { allow: [], review: ["b"], unattended: true });
    expect(doc).toEqual({ allow: [], review: ["b"], unattended: true });
  });
});

describe("mustAsk", () => {
  const apiOf = (permissions: Permissions | undefined) =>
    ({
      conversationId: 1,
      snapshot: async () => permissions,
    }) as unknown as Parameters<typeof mustAsk>[1];
  const context = {} as Context;

  it("asks for a tool the permissions doc does not allow, and runs one it does", async () => {
    const api = apiOf({ allow: ["read_inbox"] });
    expect(await mustAsk("read_inbox", api, context)).toBe(false);
    expect(await mustAsk("send_email", api, context)).toBe(true);
  });

  it("asks for every tool when the conversation has no permissions doc", async () => {
    const api = apiOf(undefined);
    expect(await mustAsk("read_inbox", api, context)).toBe(true);
    expect(await mustAsk("send_email", api, context)).toBe(true);
  });

  it("asks for every tool when the doc is empty", async () => {
    const api = apiOf({ allow: [] });
    expect(await mustAsk("read_inbox", api, context)).toBe(true);
  });
});
