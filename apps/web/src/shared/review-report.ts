export interface ReviewReport {
  brief: string;
  findings: Array<{
    severity: "bug" | "test" | "nit" | "question";
    title: string;
    body: string;
    path: string;
    line: number;
  }>;
}

const SEVERITIES = new Set(["bug", "test", "nit", "question"]);
const FENCE = /```review-report\s*\n([\s\S]*?)\n```/g;

function findingOf(raw: unknown): ReviewReport["findings"][number] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { severity, title, body, path, line } = raw as Record<string, unknown>;
  if (typeof title !== "string" || typeof path !== "string" || !title.trim() || !path.trim()) {
    return undefined;
  }
  return {
    severity: SEVERITIES.has(severity as string)
      ? (severity as ReviewReport["findings"][number]["severity"])
      : "question",
    title: title.trim().slice(0, 200),
    body: typeof body === "string" ? body.trim().slice(0, 4000) : "",
    path: path.trim().replace(/^\.?\//, ""),
    line: Number.isInteger(line) && (line as number) > 0 ? (line as number) : 1,
  };
}

export function parseReviewReport(answer: string): ReviewReport | undefined {
  const block = [...answer.matchAll(FENCE)].at(-1)?.[1];
  if (!block) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const { brief, findings } = parsed as Record<string, unknown>;
  return {
    brief: typeof brief === "string" ? brief.trim().slice(0, 2000) : "",
    findings: (Array.isArray(findings) ? findings : [])
      .map(findingOf)
      .filter((finding) => finding !== undefined)
      .slice(0, 40),
  };
}

const REVIEW_REQUEST_HEAD = "Review this pull request.";

export function reviewRequest(previous: string | null): string {
  return [
    `${REVIEW_REQUEST_HEAD} Read the changed files against the base branch as a careful reviewer would: correctness first, then missing tests, then smaller things. Run the project's tests if that is quick. Do not change any file.`,
    previous
      ? `The owner last reviewed commit ${previous}. Say in the brief what changed since then.`
      : "",
    "Then answer with a short brief for the owner and end with one fenced block, exactly in this form:",
    "```review-report",
    '{"brief": "What the change does, what you ran, and what to read first.", "findings": [{"severity": "bug", "title": "One line", "body": "Why it is a problem and what to do instead, written as a review comment.", "path": "src/file.ts", "line": 12}]}',
    "```",
    "severity is bug, test, nit or question. path is relative to the repository root and line is a line number in the new version of the file. Report only what you would raise in a real review; an empty findings list is a fine answer.",
  ]
    .filter(Boolean)
    .join("\n");
}
