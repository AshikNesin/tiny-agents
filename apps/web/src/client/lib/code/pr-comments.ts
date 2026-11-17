/**
 * Every comment on a pull request as one list for the PR tab: conversation
 * comments, review summaries and line threads, newest first, each marked as
 * a person's or a bot's so the tab can sort them into All, Humans and Bots.
 */
import type { PullView } from "../../../shared/api/code";

type Snapshot = NonNullable<PullView["snapshot"]>;
type Author = Snapshot["comments"][number]["author"];

export type Audience = "all" | "human" | "bot";

export interface PrComment {
  id: string;
  author: string;
  bot: boolean;
  body: string;
  createdAt: string;
  /** A line thread's file and line. */
  where?: { path: string; line: number | null; resolved: boolean; outdated: boolean };
  /** A review's verdict, when it is more than a comment. */
  verdict?: "approved" | "changes requested";
  /** Later replies in a line thread. */
  replies: Array<{ id: string; author: string; bot: boolean; body: string; createdAt: string }>;
  /** Auto-fix does not take instructions from this author. */
  ignored: boolean;
}

/** Review services GitHub reports as ordinary users. */
const AUTOMATION = [
  "coderabbit",
  "greptile",
  "codecov",
  "sonarcloud",
  "sonarqube",
  "sourcery",
  "deepsource",
  "snyk",
  "qodo",
  "codium",
  "ellipsis",
  "copilot",
  "codex-connector",
  "dependabot",
  "renovate",
  "github-actions",
  "vercel",
  "netlify",
];

function isBot(author: Author): boolean {
  const login = author.login.toLowerCase();
  return (
    author.type === "bot" ||
    login.endsWith("[bot]") ||
    /(^|[-_])bot$/.test(login) ||
    AUTOMATION.some((name) => login.includes(name))
  );
}

const VERDICT: Record<string, PrComment["verdict"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
};

export function prComments(pr: PullView): PrComment[] {
  const snap = pr.snapshot;
  if (!snap) return [];
  const ignored = new Set(pr.ignored);
  const list: PrComment[] = [
    ...snap.comments.map((c) => ({
      id: c.id,
      author: c.author.login,
      bot: isBot(c.author),
      body: c.body,
      createdAt: c.createdAt,
      replies: [],
      ignored: false,
    })),
    ...snap.reviews
      .filter((r) => r.body.trim() || VERDICT[r.state])
      .map((r) => ({
        id: r.id,
        author: r.author.login,
        bot: isBot(r.author),
        body: r.body,
        createdAt: r.submittedAt,
        verdict: VERDICT[r.state],
        replies: [],
        ignored: ignored.has(r.id),
      })),
    ...snap.threads.flatMap((t) => {
      const [first, ...rest] = t.comments;
      if (!first) return [];
      return [
        {
          id: t.id,
          author: first.author.login,
          bot: isBot(first.author),
          body: first.body,
          createdAt: first.createdAt,
          where: { path: t.path, line: t.line, resolved: t.resolved, outdated: t.outdated },
          replies: rest.map((c) => ({
            id: c.id,
            author: c.author.login,
            bot: isBot(c.author),
            body: c.body,
            createdAt: c.createdAt,
          })),
          ignored: ignored.has(t.id),
        },
      ];
    }),
  ];
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function audienceCounts(list: PrComment[]): Record<Audience, number> {
  const bot = list.filter((c) => c.bot).length;
  return { all: list.length, human: list.length - bot, bot };
}

export function byAudience(list: PrComment[], audience: Audience): PrComment[] {
  if (audience === "all") return list;
  return list.filter((c) => c.bot === (audience === "bot"));
}
