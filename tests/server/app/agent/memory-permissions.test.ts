import { describe, expect, it } from "vite-plus/test";
import { defaultPermission } from "../../../../packages/agent/src/capabilities";
import { createMemoryCapability } from "../../../../packages/agent/src/toolkits/memory";

describe("memory tool permissions", () => {
  it("saves a memory without asking, but asks before forgetting one", () => {
    const method = async () => ({ status: "saved" as const });
    const memory = createMemoryCapability({
      list: async () => [],
      remember: method,
      forget: async () => ({ removed: [] }),
    } as never);
    const byName = new Map(memory.tools.map((tool) => [tool.name, tool]));
    expect(defaultPermission(byName.get("remember")!)).toBe("allow");
    expect(defaultPermission(byName.get("forget")!)).toBe("ask");
  });
});
