/**
 * Imperative tool labels (issue #85): every built-in tool carries an
 * `askLabel` that completes "<bot> wants to …" on an approval card, and the
 * bot editor capitalizes it for the tool's row. Toolkits are built with every
 * optional tool switched on, so a new tool without one fails here.
 */
import { describe, expect, it } from "vite-plus/test";
import { createToolSearchCapability } from "../../../../packages/agent/src/capabilities";
import { createSkillsCapability } from "../../../../packages/agent/src/skills";
import { createAttachmentsToolkit } from "../../../../packages/agent/src/toolkits/attachments";
import { createBotsToolkit } from "../../../../packages/agent/src/toolkits/bots";
import { createBrowserToolkit } from "../../../../packages/agent/src/toolkits/browser";
import { createMemoryCapability } from "../../../../packages/agent/src/toolkits/memory";
import { createQuestionsCapability } from "../../../../packages/agent/src/toolkits/questions";
import { createRoutinesToolkit } from "../../../../packages/agent/src/toolkits/routines";
import { createSandboxToolkit } from "../../../../packages/agent/src/toolkits/sandbox";
import { createTasksToolkit } from "../../../../packages/agent/src/toolkits/tasks";
import { createVaultToolkit } from "../../../../packages/agent/src/toolkits/vault";
import { createVisionToolkit } from "../../../../packages/agent/src/toolkits/vision";
import { createWebToolkit } from "../../../../packages/agent/src/toolkits/web";

const stub = {} as never;

const capabilities = [
  createToolSearchCapability(),
  createSkillsCapability(stub),
  createAttachmentsToolkit(stub, { sandbox: stub }),
  createBotsToolkit(stub),
  createBrowserToolkit({
    vault: stub,
    ownerWaits: stub,
    transport: stub,
    profilesDir: "/tmp/ta-test-profiles",
  }),
  createMemoryCapability({ remember: async () => stub, forget: async () => stub } as never),
  createQuestionsCapability(stub),
  createRoutinesToolkit(stub),
  createSandboxToolkit({ connection: stub }),
  createTasksToolkit(stub),
  createVaultToolkit({ broker: stub }),
  createVisionToolkit(stub, stub),
  createWebToolkit({ apiKey: "key", vault: stub }),
];
const tools = capabilities.flatMap((capability) =>
  capability.tools.map((tool) => ({ ...tool, capability: capability.id })),
);

describe("built-in tool askLabels", () => {
  it("covers the optional tools too", () => {
    const names = tools.map((tool) => tool.name);
    for (const name of [
      "copy_attachment_to_sandbox",
      "browser_fill_secret",
      "request_credentials",
      "forget",
      "http_request",
      "save_skill",
    ]) {
      expect(names).toContain(name);
    }
  });

  it.each(tools.map((tool) => [`${tool.capability}/${tool.name}`, tool] as const))(
    "%s has a lowercase imperative askLabel",
    (_, tool) => {
      expect(tool.askLabel, tool.name).toMatch(/^[a-z]/);
      // An imperative verb, not the done-label's past tense ("opened a page").
      expect(tool.askLabel!.split(" ")[0]).not.toMatch(/ed$/);
    },
  );

  it("reads as a sentence on the approval card", () => {
    const ask = Object.fromEntries(tools.map((tool) => [tool.name, tool.askLabel]));
    expect(`Chief wants to ${ask.browser_navigate}`).toBe("Chief wants to open a page");
    expect(`Chief wants to ${ask.delete_task}`).toBe("Chief wants to delete a task");
    expect(`Chief wants to ${ask.message_bot}`).toBe("Chief wants to message another bot");
  });
});
