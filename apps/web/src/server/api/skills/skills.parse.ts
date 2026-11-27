import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import { SKILL_NAME } from "@tiny-agents/agent";
import { Boom } from "@groot/core/errors";
import type { ParsedSkill, SkillFile } from "../../../shared/api/skills";

export const MAX_FILES = 50;
export const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 1_000_000;
const skillFilesSchema: z.ZodType<SkillFile[]> = z.array(
  z.object({ path: z.string(), content: z.string() }),
);

export function skillFiles(raw: string): SkillFile[] {
  try {
    return parseJson("A skill's stored files", raw, skillFilesSchema);
  } catch {
    return [];
  }
}

const SCRIPT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1|bat|exe)$/i;

function frontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const match = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fields: {}, body: raw };
  const fields: Record<string, string> = {};
  let key: string | undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      key = pair[1];
      fields[key] = pair[2].replace(/^[>|][-+]?\s*$/, "").trim();
    } else if (key && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  for (const [k, v] of Object.entries(fields)) {
    fields[k] = v.replace(/^(['"])([\s\S]*)\1$/, "$2");
  }
  return { fields, body: match[2] };
}

export function skillHeading(raw: string): { name: string; description: string } | undefined {
  const { fields } = frontmatter(raw);
  const name = fields.name?.trim() ?? "";
  const description = fields.description?.trim() ?? "";
  return SKILL_NAME.test(name) && description ? { name, description } : undefined;
}

export function parseSkillMarkdown(raw: string, files: SkillFile[] = []): ParsedSkill {
  const { fields, body } = frontmatter(raw);
  const name = fields.name?.trim() ?? "";
  const description = fields.description?.trim() ?? "";
  if (!name || !description) {
    throw Boom.badRequest("SKILL.md needs frontmatter with `name` and `description`.");
  }
  if (!SKILL_NAME.test(name) || name.length > 64) {
    throw Boom.badRequest(
      `Skill name "${name}" must be lowercase letters, digits and hyphens (max 64).`,
    );
  }
  if (description.length > 1024)
    throw Boom.badRequest("Skill description is over 1024 characters.");
  const warnings: string[] = [];
  const scripts = files.filter((file) => SCRIPT.test(file.path));
  if (scripts.length > 0) {
    warnings.push(
      `Contains ${scripts.length} script file(s) (${scripts.map((f) => f.path).join(", ")}): stored as text, never executed.`,
    );
  }
  return { name, description, body: body.trim(), files, warnings };
}

interface GitHubTarget {
  owner: string;
  repo: string;
  ref?: string;
  dir: string;
}

export function parseGitHubUrl(raw: string): GitHubTarget {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw Boom.badRequest("Not a valid URL.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const stripSkill = (path: string[]) =>
    (path.at(-1)?.toLowerCase() === "skill.md" ? path.slice(0, -1) : path).join("/");
  if (url.hostname === "raw.githubusercontent.com" && parts.length >= 3) {
    const [owner, repo, ref, ...path] = parts;
    return { owner, repo, ref, dir: stripSkill(path) };
  }
  if (url.hostname === "github.com" && parts.length >= 2) {
    const [owner, repo, kind, ref, ...path] = parts;
    if (!kind) return { owner, repo: repo.replace(/\.git$/, ""), dir: "" };
    if ((kind === "tree" || kind === "blob") && ref) {
      return { owner, repo, ref, dir: stripSkill(path) };
    }
  }
  throw Boom.badRequest("Use a github.com link to a skill folder or its SKILL.md.");
}

interface ContentItem {
  type: "file" | "dir";
  name: string;
  path: string;
  size: number;
  download_url: string | null;
}

export async function fetchSkillFromGitHub(
  raw: string,
  doFetch: typeof fetch = fetch,
): Promise<ParsedSkill> {
  const target = parseGitHubUrl(raw);
  const api = `https://api.github.com/repos/${target.owner}/${target.repo}/contents`;
  const ref = target.ref ? `?ref=${encodeURIComponent(target.ref)}` : "";
  const get = async (url: string) => {
    const response = await doFetch(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "tiny-agents" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw Boom.badRequest(`GitHub returned ${response.status} for ${url.replace(api, "")}`);
    }
    return response;
  };
  const list = async (dir: string): Promise<ContentItem[]> => {
    const response = await get(`${api}/${dir}${ref}`);
    const items = (await response.json()) as ContentItem[] | ContentItem;
    return Array.isArray(items) ? items : [items];
  };

  const files: SkillFile[] = [];
  let skillMd: string | undefined;
  let total = 0;
  const warnings: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const item of await list(dir)) {
      const relative = target.dir ? item.path.slice(target.dir.length + 1) : item.path;
      if (item.type === "dir") {
        if (depth < 3) await walk(item.path, depth + 1);
        continue;
      }
      if (!item.download_url) continue;
      if (
        item.size > MAX_FILE_BYTES ||
        files.length >= MAX_FILES ||
        total + item.size > MAX_TOTAL_BYTES
      ) {
        warnings.push(`Skipped ${relative} (size limit).`);
        continue;
      }
      const text = await (await get(item.download_url)).text();
      if (text.includes("\u0000")) {
        warnings.push(`Skipped ${relative} (binary).`);
        continue;
      }
      total += item.size;
      if (relative.toLowerCase() === "skill.md") skillMd = text;
      else files.push({ path: relative, content: text });
    }
  };
  await walk(target.dir, 0);
  if (skillMd === undefined) throw Boom.badRequest("No SKILL.md found at that link.");
  const parsed = parseSkillMarkdown(skillMd, files);
  return { ...parsed, sourceUrl: raw.trim(), warnings: [...parsed.warnings, ...warnings] };
}
