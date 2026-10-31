import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vite-plus/test";
import {
  applyPermissions,
  compilePolicy,
  resolveModelId,
  type Capability,
  type CapabilitySelection,
} from "../../../../packages/agent/src/index";
import { toModelInfo } from "../../../../packages/agent/src/models";

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
    tools: [tool("read_inbox"), tool("send_email"), tool("save_skill"), tool("report_blocked")],
  }),
  tools: [
    { name: "read_inbox", label: "", description: "", readOnly: true },
    { name: "send_email", label: "", description: "" },
    { name: "save_skill", label: "", description: "", askOnly: true },
    { name: "report_blocked", label: "", description: "", readOnly: true, unattendedOnly: true },
  ],
};
const catalog = new Map([[mail.id, mail]]);
const installed = { extension: (id: string) => (id === "mail" ? mail.extension : undefined) };

const compile = (selection: Partial<CapabilitySelection>) =>
  compilePolicy(catalog, { enabled: ["mail"], permissions: {}, ...selection }, installed);

describe("compilePolicy", () => {
  it.each([
    // [case, selection, allow, review, removed, unattended]
    [
      "defaults: read-only allowed, the rest asks",
      {},
      ["read_inbox"],
      undefined,
      ["report_blocked"],
    ],
    [
      "an explicit allow, an off tool is removed",
      { permissions: { send_email: "allow", read_inbox: "off" } },
      ["send_email"],
      undefined,
      ["read_inbox", "report_blocked"],
    ],
    [
      "askOnly never resolves to allow",
      { permissions: { save_skill: "allow" } },
      ["read_inbox"],
      undefined,
      ["report_blocked"],
    ],
    [
      "auto-review lists the asking tools, never askOnly ones",
      { autoReview: true },
      ["read_inbox"],
      ["send_email"],
      ["report_blocked"],
    ],
    [
      "unattended: review is off, unattended-only tools are offered",
      { autoReview: true, unattended: true },
      ["read_inbox", "report_blocked"],
      undefined,
      [],
    ],
  ] as const)("%s", (_case, selection, allow, review, removed) => {
    const policy = compile(selection as Partial<CapabilitySelection>);
    expect(policy.permissions.allow).toEqual(allow);
    expect(policy.permissions.review).toEqual(review);
    expect(policy.remove.map((t) => t.name)).toEqual(removed);
    expect(policy.extensions).toEqual([mail.extension]);
    expect(policy.permissions.unattended).toBe(selection.unattended ? true : undefined);
  });

  it("ignores capabilities that are not in the catalog or not installed", () => {
    const policy = compilePolicy(
      catalog,
      { enabled: ["mail", "ghost"], permissions: {} },
      { extension: () => undefined },
    );
    expect(policy.extensions).toEqual([]);
    expect(policy.remove).toEqual([]);
    expect(policy.permissions.allow).toEqual(["read_inbox"]);
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

describe("model ids", () => {
  const known = new Set(["gw/claude", "acme/glm"]);
  const has = (provider: string, model: string) => known.has(`${provider}/${model}`);

  it("resolves catalog ids against the default provider and custom: ids against theirs", () => {
    expect(resolveModelId("claude", "gw", has)).toEqual({ provider: "gw", model: "claude" });
    expect(resolveModelId("custom:acme/glm", "gw", has)).toEqual({
      provider: "acme",
      model: "glm",
    });
    expect(resolveModelId("custom:/glm", "gw", has)).toBeUndefined();
    expect(resolveModelId("custom:acme/nope", "gw", has)).toBeUndefined();
    expect(resolveModelId("nope", "gw", has)).toBeUndefined();
  });

  it("puts a custom provider's models in the 'other' family by their custom: tag", () => {
    const model = {
      id: "glm",
      name: "GLM",
      api: "openai-completions",
      reasoning: false,
      contextWindow: 8192,
      input: [],
    } as never;
    expect(toModelInfo(model, "custom:acme")).toMatchObject({
      id: "custom:acme/glm",
      family: "other",
    });
    expect(toModelInfo(model)).toMatchObject({ id: "glm", family: "openai" });
  });
});
