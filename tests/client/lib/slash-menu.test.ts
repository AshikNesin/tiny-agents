import { describe, expect, it } from "vite-plus/test";
import { slashEntries, toolPickLabel } from "@/lib/slash-menu";
import { splitToolPicks } from "../../../apps/web/src/shared/tool-picks";

const github = { slug: "github", name: "GitHub" };
const tools = [
  {
    name: "mcp__github__list_issues",
    label: "List issues",
    description: "Open issues",
    connection: github,
  },
  { name: "mcp__github__create_issue", label: "Create issue", description: "", connection: github },
  {
    name: "mcp__linear__search",
    label: "Search",
    description: "Find tickets",
    connection: { slug: "linear", name: "Linear" },
  },
];

describe("slash menu", () => {
  it("lists commands, skills and each connection on a bare slash, without single tools", () => {
    expect(
      slashEntries("", {
        commands: [{ command: "/new", hint: "Start a new chat" }],
        skills: [{ name: "triage", description: "Triage issues" }],
        tools,
      }),
    ).toEqual([
      { kind: "command", value: "/new", label: "/new", detail: "Start a new chat" },
      { kind: "skill", value: "triage", label: "triage", detail: "Triage issues" },
      {
        kind: "connection",
        value: "mcp__github__*",
        label: "github",
        detail: "Every GitHub tool (2)",
      },
      {
        kind: "connection",
        value: "mcp__linear__*",
        label: "linear",
        detail: "Every Linear tool (1)",
      },
    ]);
  });

  it("finds single tools by connection or tool name, leaving out what is picked", () => {
    expect(slashEntries("git", { tools, picked: ["mcp__github__create_issue"] })).toEqual([
      {
        kind: "connection",
        value: "mcp__github__*",
        label: "github",
        detail: "Every GitHub tool (2)",
      },
      {
        kind: "tool",
        value: "mcp__github__list_issues",
        label: "List issues",
        detail: "GitHub · Open issues",
      },
    ]);
    expect(slashEntries("list_", { tools }).map((entry) => entry.value)).toEqual([
      "mcp__github__list_issues",
    ]);
    expect(slashEntries("list", { tools, picked: ["mcp__github__*"] })).toEqual([]);
  });

  it("names a pick for its chip", () => {
    expect(toolPickLabel("mcp__github__list_issues", tools)).toBe("GitHub: List issues");
    expect(toolPickLabel("mcp__linear__*", tools)).toBe("Linear (all tools)");
  });

  it("reads the picked tools back off a sent message", () => {
    expect(
      splitToolPicks(
        "Use these tools for this request: mcp__github__list_issues, mcp__linear__*. Load any that are not loaded yet before you start.\n\nWhat is open?",
      ),
    ).toEqual({ tools: ["mcp__github__list_issues", "mcp__linear__*"], text: "What is open?" });
    expect(splitToolPicks("Use these tools for this request: rm -rf.")).toEqual({
      tools: [],
      text: "Use these tools for this request: rm -rf.",
    });
  });
});
