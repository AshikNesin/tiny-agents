import { describe, expect, it } from "vite-plus/test";
import {
  applyPreset,
  groupValue,
  matchesQuery,
  setAll,
  summary,
  toolTitle,
  type ToolInfo,
} from "@/lib/tool-permissions";

const read: ToolInfo = {
  name: "notion_search",
  label: "Searched Notion",
  askLabel: "search Notion",
  description: "Find pages",
  readOnly: true,
};
const write: ToolInfo = {
  name: "notion_delete_page",
  label: "Deleted a page",
  askLabel: "delete a Notion page",
  description: "Remove a page",
};
const vault: ToolInfo = {
  name: "vault_use",
  label: "Used a secret",
  description: "Fill a secret",
  readOnly: true,
  askOnly: true,
};

describe("tool permissions (issue #91)", () => {
  it("titles a tool by what it does, falling back to its activity label", () => {
    expect(toolTitle(write)).toBe("Delete a Notion page");
    expect(toolTitle(vault)).toBe("Used a secret");
  });

  it("matches every query word across name, labels, description and toolkit", () => {
    expect(matchesQuery(write, "Notion", "notion delete")).toBe(true);
    expect(matchesQuery(write, "Notion", "delete page")).toBe(true);
    expect(matchesQuery(read, "Notion", "notion")).toBe(true);
    expect(matchesQuery(read, "Notion", "delete")).toBe(false);
    expect(matchesQuery(read, "Notion", "  ")).toBe(true);
  });

  it("reads a group's shared value, or mixed, and counts it", () => {
    expect(groupValue({}, [write])).toBe("ask");
    expect(groupValue({}, [read, write])).toBe("mixed");
    expect(summary({}, [read, write, vault])).toBe("1 allow · 2 ask");
    expect(summary({ notion_search: "off" }, [read])).toBe("1 off");
  });

  it("sets a whole group, keeping Ask (always) tools asking", () => {
    const next = setAll({}, [read, write, vault], "allow");
    expect(next).toEqual({ notion_search: "allow", notion_delete_page: "allow", vault_use: "ask" });
    expect(groupValue(setAll({}, [read, write], "off"), [read, write])).toBe("off");
  });

  it("applies the presets", () => {
    const tools = [read, write, vault];
    expect(applyPreset({ notion_search: "off" }, tools, "read-only")).toEqual({
      notion_search: "allow",
      notion_delete_page: "ask",
      vault_use: "ask",
    });
    expect(applyPreset({}, tools, "ask-all")).toEqual({
      notion_search: "ask",
      notion_delete_page: "ask",
      vault_use: "ask",
    });
  });
});
