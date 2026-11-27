import { Type } from "typebox";
import { section, type ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Capability } from "./capabilities";
import { defineToolkit, tool } from "./toolkit";

interface SkillSummary {
  name: string;
  description: string;
}

interface SkillContent extends SkillSummary {
  body: string;
  files: string[];
}

export interface SkillStore {
  list(conversationId: number): Promise<SkillSummary[]>;
  get(conversationId: number, name: string): Promise<SkillContent | undefined>;
  readFile(conversationId: number, name: string, path: string): Promise<string | undefined>;
  save(
    conversationId: number,
    skill: { name: string; description: string; body: string },
  ): Promise<{ created: boolean }>;
}

export const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const ok = (text: string): ToolExecutionResult => ({ output: [{ type: "text", text }] });
const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

export function createSkillsCapability(store: SkillStore): Capability {
  const loadSkill = tool({
    name: "load_skill",
    label: "Using skill",
    askLabel: "use a skill",
    summary: "Load a skill",
    policy: { readOnly: true },
    description:
      "Load a skill's full instructions by name. Do this before a task one of your skills covers, then follow them.",
    parameters: Type.Object({ name: Type.String() }),
    replay: "safe",
    execute: async (args, api) => {
      const skill = await store.get(Number(api.conversationId), args.name);
      if (!skill) return fail(`No skill named "${args.name}".`);
      const files =
        skill.files.length > 0
          ? `\n\nBundled files (read with read_skill_file): ${skill.files.join(", ")}`
          : "";
      return ok(`# ${skill.name}\n${skill.description}\n\n${skill.body}${files}`);
    },
  });

  const readSkillFile = tool({
    name: "read_skill_file",
    label: "Read skill file",
    askLabel: "read a skill file",
    summary: "Read a skill's file",
    policy: { readOnly: true },
    description: "Read a file bundled with a skill (paths as listed by load_skill).",
    parameters: Type.Object({ name: Type.String(), path: Type.String() }),
    replay: "safe",
    execute: async (args, api) => {
      const text = await store.readFile(Number(api.conversationId), args.name, args.path);
      return text === undefined
        ? fail(`Skill "${args.name}" has no file "${args.path}".`)
        : ok(text);
    },
  });

  const saveSkill = tool({
    name: "save_skill",
    label: "Saved skill",
    askLabel: "save a skill",
    summary: "Save a workflow as a skill",
    policy: { askOnly: true },
    description:
      "Save a reusable workflow as a skill (create, or update one you saved before). Use when the owner shows you how they like a task done. The owner approves every save.",
    parameters: Type.Object({
      name: Type.String({
        pattern: SKILL_NAME.source,
        maxLength: 64,
        description: "lowercase-with-hyphens",
      }),
      description: Type.String({
        minLength: 1,
        maxLength: 1024,
        description: "What the skill does and when to use it",
      }),
      body: Type.String({ minLength: 1, maxLength: 50_000, description: "Markdown instructions" }),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const { created } = await store.save(Number(api.conversationId), args);
      return ok(`${created ? "Saved new" : "Updated"} skill "${args.name}".`);
    },
  });

  const listing = section("skills", async (input) => {
    const skills = await store.list(Number(input.conversationId));
    if (skills.length === 0) return undefined;
    const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
    return `You have these skills (reusable instructions). When a task matches one, call load_skill with its name first and follow it. When a message starts with /<skill-name>, the owner is asking for that skill: load it before anything else.\n${lines.join("\n")}`;
  });

  return defineToolkit({
    id: "skills",
    kind: "skills",
    name: "Skills",
    description: "Reusable instructions from your skill library",
    tools: [loadSkill, readSkillFile, saveSkill],
    sections: [listing],
  });
}
