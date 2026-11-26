import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodingSkill } from "./coding-protocol";

const SKILLS_PLUGIN = "tiny-agents";

function insideSkill(dir: string, file: string): string | undefined {
  const target = path.resolve(dir, file);
  return target.startsWith(`${dir}${path.sep}`) ? target : undefined;
}

function skillMarkdown(skill: CodingSkill): string {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.body}\n`;
}

async function writeSkill(dir: string, skill: CodingSkill): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), skillMarkdown(skill));
  const files = skill.files.flatMap((file) => {
    const target = insideSkill(dir, file.path);
    return target && path.basename(target) !== "SKILL.md"
      ? [{ target, content: file.content }]
      : [];
  });
  await Promise.all(
    files.map(async ({ target, content }) => {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
}

export async function writeSkillsPlugin(
  root: string,
  skills: readonly CodingSkill[],
): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, ".claude-plugin"), { recursive: true });
  await writeFile(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: SKILLS_PLUGIN, description: "Skills shared from tiny-agents" }),
  );
  await Promise.all(
    skills.map((skill) => writeSkill(path.join(root, "skills", skill.name), skill)),
  );
}
