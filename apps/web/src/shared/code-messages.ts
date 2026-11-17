/**
 * Messages the app writes into a Code thread on the owner's behalf: the
 * project line at the top of a project thread's first message, and an
 * Auto-fix request. The server builds them with these pieces and the
 * transcript reads them back with the parsers, so the owner sees a short
 * line or card instead of the agent's full instructions.
 */

/** What a project thread's agent is told about pushing, after the project line. */
export const PROJECT_RULE =
  "Work and commit on this branch. Do not push or open a pull request: the app publishes it.";

/** `[Project acme/web · branch ta/fix-login · base main]`. */
export function projectHeader(repo: string, branch: string, base: string): string {
  return `[Project ${repo} · branch ${branch} · base ${base}]`;
}

/** The first sentence of an Auto-fix pass's request. */
export const PASS_HEAD = "Auto-fix pass.";
/** The first sentence of the final check's request. */
export const FINAL_HEAD = "Auto-fix final check.";

const PREAMBLE = new RegExp(
  "^\\[Project (\\S+) · branch (\\S+) · base (\\S+)\\]\\n" +
    PROJECT_RULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "(?:\\nRun `[^\\n]*` before you report done\\.)?" +
    "(\\nNote: the project's setup script failed:\\n```\\n[\\s\\S]*?\\n```)?\\n\\n",
);

/** The project line taken off the top of a message, or null when it has none. */
export function splitProjectPreamble(
  text: string,
): { branch: string; base: string; setupFailed: boolean; message: string } | null {
  const match = PREAMBLE.exec(text);
  if (!match) return null;
  return {
    branch: match[2]!,
    base: match[3]!,
    setupFailed: Boolean(match[4]),
    message: text.slice(match[0].length),
  };
}

/**
 * An Auto-fix request: which kind, and the id and title of each item it lists (a
 * failing check, a review comment), or null for any other message.
 */
export function parseAutofixRequest(
  text: string,
): { kind: "pass" | "final"; items: Array<{ id: string; title: string }> } | null {
  if (text.startsWith(FINAL_HEAD)) return { kind: "final", items: [] };
  if (!text.startsWith(PASS_HEAD)) return null;
  const begin = text.indexOf("----- BEGIN UNTRUSTED PR DATA -----\n");
  const end = text.lastIndexOf("\n----- END UNTRUSTED PR DATA -----");
  if (begin < 0 || end < begin) return { kind: "pass", items: [] };
  const lines = text.slice(begin, end).split("\n");
  const items: Array<{ id: string; title: string }> = [];
  lines.forEach((line, i) => {
    const title = lines[i + 1];
    if (line.startsWith("### ") && title) items.push({ id: line.slice(4), title });
  });
  return { kind: "pass", items };
}
