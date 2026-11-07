/**
 * Skills (issue #1 D5–D7): Agent Skills (`SKILL.md`) from the app's shared
 * library, assigned per bot.
 *
 * The `skills` capability brings:
 * - a prompt section listing the bot's skills by name and description only
 *   (stable between turns, so the provider's prompt cache keeps working);
 * - `load_skill` / `read_skill_file`, which return a skill's instructions and
 *   bundled files only when the model decides it needs them;
 * - `save_skill`, so a bot can turn a workflow it was shown into a skill. It
 *   is `askOnly`: the owner always approves it.
 *
 * Skill scripts are stored as text and never executed.
 */
import { Type } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  section,
  type ToolExecutionResult,
} from "@earendil-works/pi-durable";
import type { Capability } from "./capabilities";

interface SkillSummary {
  name: string;
  description: string;
}

interface SkillContent extends SkillSummary {
  body: string;
  files: string[];
}

/** The app's adapter over its skill library, scoped to the bot behind a conversation. */
export interface SkillStore {
  /** Skills assigned to the conversation's bot. */
  list(conversationId: number): Promise<SkillSummary[]>;
  /** One assigned skill by name. */
  get(conversationId: number, name: string): Promise<SkillContent | undefined>;
  /** A bundled file of an assigned skill. */
  readFile(conversationId: number, name: string, path: string): Promise<string | undefined>;
  /** Create the skill (or update the bot's own skill of that name) and assign it to the bot. */
  save(
    conversationId: number,
    skill: { name: string; description: string; body: string },
  ): Promise<{ created: boolean }>;
}

/** Agent Skills naming: lowercase letters, digits and single hyphens, ≤ 64 chars. */
export const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const ok = (text: string): ToolExecutionResult => ({ output: [{ type: "text", text }] });
const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

export function createSkillsCapability(store: SkillStore): Capability {
  const loadSkill = defineTool({
    name: "load_skill",
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

  const readSkillFile = defineTool({
    name: "read_skill_file",
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

  const saveSkill = defineTool({
    name: "save_skill",
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
    // Upserting by name is idempotent, so a rerun after a restart is harmless.
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
    return `You have these skills (reusable instructions). When a task matches one, call load_skill with its name first and follow it.\n${lines.join("\n")}`;
  });

  return {
    id: "skills",
    kind: "skills",
    name: "Skills",
    description: "Reusable instructions from your skill library",
    extension: defineExtension({
      name: "skills",
      tools: [loadSkill, readSkillFile, saveSkill],
      sections: [listing],
    }),
    tools: [
      {
        name: "load_skill",
        label: "Using skill",
        askLabel: "use a skill",
        description: "Load a skill",
        readOnly: true,
      },
      {
        name: "read_skill_file",
        label: "Read skill file",
        askLabel: "read a skill file",
        description: "Read a skill's file",
        readOnly: true,
      },
      {
        name: "save_skill",
        label: "Saved skill",
        askLabel: "save a skill",
        description: "Save a workflow as a skill",
        askOnly: true,
      },
    ],
  };
}
