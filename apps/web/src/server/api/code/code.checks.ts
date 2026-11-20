import { Boom } from "@groot/core/errors";
import { GitHubError } from "@tiny-agents/github";
import type { CheckLogView } from "../../../shared/api/code";
import { codeGitHub } from "./code.github";
import { projectThread, repoOf } from "./code.projects";
import { cachedSnapshot, openPullOf } from "./code.pulls.store";

const LOG_CHARS = 64_000;
const BEFORE = 8;
const MAX_LINES = 30;

const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const ERROR_LINE =
  /##\[error\]|::error|\bFAIL(?:ED)?\b|\b[A-Z]\w*Error\b|\berror(?:\[\w+\])?:|\bERR!|panic:|✗|✖/;
const MESSAGE_LINE = /\b[A-Z]\w*Error\b|\berror(?:\[\w+\])?:|##\[error\]|panic:/;
const EXIT_LINE = /Process completed with exit code/;

function clean(raw: string): string[] {
  const lines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.replace(TIMESTAMP, "").replace(ANSI, "").trimEnd();
    if (text === "##[endgroup]") continue;
    lines.push(text.startsWith("##[group]") ? text.slice("##[group]".length) : text);
  }
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines;
}

function logExcerpt(raw: string): Omit<CheckLogView, "name" | "url" | "running"> {
  const all = clean(raw);
  const errors = all.flatMap((line, i) => (ERROR_LINE.test(line) ? [i] : []));
  const anchor = errors.find((i) => !EXIT_LINE.test(all[i]!));
  let start: number;
  let end: number;
  if (anchor === undefined) {
    start = Math.max(0, all.length - MAX_LINES);
    end = all.length;
  } else {
    start = Math.max(0, anchor - BEFORE);
    end = Math.min(all.length, start + MAX_LINES);
  }
  const picked = all.slice(start, end).map((line, i) => ({ line, at: start + i }));
  const last = all.length - 1;
  const isError = new Set(errors);
  if (end <= last && isError.has(last)) {
    picked.splice(MAX_LINES - 1, picked.length, { line: all[last]!, at: last });
  }
  const lines = picked.map((p) => p.line);
  const highlight = picked.flatMap((p, i) => (isError.has(p.at) ? [i] : []));
  const message = picked.find((p) => MESSAGE_LINE.test(p.line) && !EXIT_LINE.test(p.line));
  const summary = (message ?? (anchor === undefined ? undefined : picked[anchor - start]))?.line
    .replace("##[error]", "")
    .trim();
  return { lines, highlight, summary: summary || null };
}

export async function checkLog(threadId: string, jobId: number): Promise<CheckLogView> {
  const found = await projectThread(threadId);
  if (!found) throw Boom.badRequest("This thread is not in a project.");
  const open = await openPullOf(threadId);
  const check = open && cachedSnapshot(open)?.checks.find((c) => c.jobId === jobId);
  if (!check) throw Boom.notFound("That check is not on the open pull request.");
  const github = await codeGitHub().client(found.project);
  const repo = repoOf(found.project);
  const view = { name: check.name, url: check.url };
  if (check.state === "pending") {
    const job = await github.job(repo, jobId).catch(() => {
      throw Boom.badGateway("GitHub did not say how the check is going.");
    });
    if (!job.completed) {
      return { ...view, summary: null, lines: [], highlight: [], running: job.steps };
    }
  }
  const raw = await github.jobLogTail(repo, jobId, LOG_CHARS).catch((error: unknown) => {
    throw Boom.badGateway(
      error instanceof GitHubError && error.status === 404
        ? "GitHub no longer has this log. It may have expired."
        : "GitHub did not send the log.",
    );
  });
  return { ...view, ...logExcerpt(raw), running: null };
}
