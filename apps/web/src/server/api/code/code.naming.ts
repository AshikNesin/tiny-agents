import type { HarnessInstance } from "@tiny-agents/code/contracts";
import { logger } from "@groot/core/logger";
import { app } from "../../app-root";
import type { SideCaller } from "../bots/side-call";
import { branchSlug, cleanBranchSlug } from "./code.workspace";

export interface CodeBranchNamer {
  sideCaller: SideCaller;
}

export function setCodeBranchNamer(next: CodeBranchNamer | undefined): void {
  app().codeBranchNamer = next;
}

const NAME_TIMEOUT_MS = 8_000;
const TASK_CHARS = 1_500;
const MAX_COMMITS = 15;
const TITLE_CHARS = 60;

const THREAD_SYSTEM = [
  "You name coding tasks. Reply with exactly two lines and nothing else:",
  "title: <3 to 6 words in sentence case that say what the task is about, no trailing period>",
  "branch: <2 to 4 lowercase English words joined by hyphens that say what the change is>",
  "Name the outcome, not the request: for 'can you figure out why the export fails' use",
  "title: Debug failing export / branch: debug-export-failure, not figure-out-cause.",
  "Examples: title: Fix Safari export button / branch: fix-safari-export;",
  "title: Add dark mode to settings / branch: add-dark-mode.",
].join("\n");

const PULL_SYSTEM =
  "You write pull request titles. Reply with the title only: what the change does, in the " +
  "imperative and sentence case, at most 60 characters, no trailing period, and no prefix " +
  "such as feat:, fix: or a ticket number.";

function cleanTitle(raw: string): string | null {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!text) return null;
  text = text
    .replace(/^(pr\s+|pull request\s+)?title\s*:\s*/i, "")
    .replace(/[`*_#"“”]+/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/^[a-z]+(\([^)]*\))?!?:\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim();
  if (text.length > TITLE_CHARS) {
    const cut = text.slice(0, TITLE_CHARS);
    text = cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : TITLE_CHARS);
  }
  if (text.length < 3) return null;
  return text[0]!.toUpperCase() + text.slice(1);
}

function line(answer: string, label: RegExp): string | undefined {
  for (const l of answer.split("\n")) {
    const match = label.exec(l.trim());
    if (match) return l.trim().slice(match[0].length);
  }
  return undefined;
}

export async function threadNames(task: string): Promise<{ slug: string; title: string | null }> {
  const namer = app().codeBranchNamer;
  const text = task.trim().slice(0, TASK_CHARS);
  if (namer && text) {
    const answer = await namer.sideCaller.complete({
      role: "chat_title",
      system: THREAD_SYSTEM,
      user: `Task:\n${text}`,
      timeoutMs: NAME_TIMEOUT_MS,
      label: "Code thread name",
    });
    if (answer !== undefined) {
      const branch = line(answer, /^branch(\s+name)?\s*:\s*/i);
      const title = line(answer, /^title\s*:\s*/i);
      const slug = cleanBranchSlug(branch ?? answer);
      return { slug: slug ?? branchSlug(task), title: title ? cleanTitle(title) : null };
    }
  }
  return { slug: branchSlug(task), title: null };
}

export async function applyTitle(
  instance: HarnessInstance,
  nativeId: string,
  title: string | null,
): Promise<void> {
  if (!title || typeof instance.rename !== "function") return;
  await instance.rename(nativeId, title).catch((error: unknown) => {
    logger.warn({ err: error, instance: instance.id }, "Code: could not title the thread");
  });
}

export async function pullTitle(input: {
  thread: string | null;
  commits: string[];
}): Promise<string | null> {
  const namer = app().codeBranchNamer;
  if (!namer || input.commits.length === 0) return null;
  const subjects = input.commits.slice(-MAX_COMMITS).map((s) => `- ${s.slice(0, 120)}`);
  const answer = await namer.sideCaller.complete({
    role: "chat_title",
    system: PULL_SYSTEM,
    user: [
      ...(input.thread ? [`Thread: ${input.thread.slice(0, 120)}`] : []),
      "Commits:",
      ...subjects,
    ].join("\n"),
    timeoutMs: NAME_TIMEOUT_MS,
    label: "Code PR title",
  });
  return answer === undefined ? null : cleanTitle(answer);
}
