/**
 * A check's log excerpt for the PR tab: the open pull request's Actions job
 * log, cut to the lines around the first failure (or its last lines), with
 * GitHub's timestamps, color codes and group markers taken out.
 */
import { Boom } from "@groot/core/errors";
import type { CheckLogView } from "../../../shared/api/code";
import { codeGitHub } from "./code.github";
import { projectThread, repoOf } from "./code.projects";
import { cachedSnapshot, openPullOf } from "./code.pulls.store";

/** How much of the log's end to read: enough to reach the failure. */
const LOG_CHARS = 64_000;
const BEFORE = 8;
const MAX_LINES = 30;

const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** Case matters: `FAIL` is a test runner's verdict, `failed` usually a tally. */
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

/** The excerpt of a raw Actions log: what a reader needs before opening the full one. */
function logExcerpt(raw: string): Omit<CheckLogView, "name" | "url"> {
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
  // The step's own verdict at the very end is worth keeping when it was cut.
  const last = all.length - 1;
  if (end <= last && errors.includes(last)) {
    picked.splice(MAX_LINES - 1, picked.length, { line: all[last]!, at: last });
  }
  const lines = picked.map((p) => p.line);
  const highlight = picked.flatMap((p, i) => (errors.includes(p.at) ? [i] : []));
  const message = picked.find((p) => MESSAGE_LINE.test(p.line) && !EXIT_LINE.test(p.line));
  const summary = (message ?? (anchor === undefined ? undefined : picked[anchor - start]))?.line
    .replace("##[error]", "")
    .trim();
  return { lines, highlight, summary: summary || null };
}

/** The log of one of the open pull request's checks; any other job is not found. */
export async function checkLog(threadId: string, jobId: number): Promise<CheckLogView> {
  const found = await projectThread(threadId);
  if (!found) throw Boom.badRequest("This thread is not in a project.");
  const open = await openPullOf(threadId);
  const check = open && cachedSnapshot(open)?.checks.find((c) => c.jobId === jobId);
  if (!check) throw Boom.notFound("That check is not on the open pull request.");
  const github = await codeGitHub().client(found.project);
  const raw = await github.jobLogTail(repoOf(found.project), jobId, LOG_CHARS).catch(() => {
    throw Boom.badGateway("GitHub did not send the log. It may have expired.");
  });
  return { name: check.name, url: check.url, ...logExcerpt(raw) };
}
