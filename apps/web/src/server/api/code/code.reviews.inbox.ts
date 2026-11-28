import { isNull } from "drizzle-orm";
import { z } from "zod";
import { Boom } from "@groot/core/errors";
import { createNamespaceKv } from "@groot/core/kv";
import { parseRepo, repoSlug, type InboxFilter } from "@tiny-agents/github";
import { codeProjects, codeReviews, db } from "../../db";
import type { InboxPullView, ReviewInboxSettings, InboxQuery } from "../../../shared/api/code";
import { codeGitHub } from "./code.github";

const inboxFields = {
  repos: z.enum(["all", "projects"]),
  direct: z.boolean(),
  drafts: z.boolean(),
  bots: z.boolean(),
  mute: z
    .array(z.string().max(200))
    .max(100)
    .transform((words) => [...new Set(words.map((w) => w.trim()).filter(Boolean))]),
  limit: z.number().int().min(1).max(100),
};

export const inboxSettingsChange = z.object(inboxFields).partial();

const inboxSettingsSchema = z.object({
  repos: inboxFields.repos.default("all"),
  direct: inboxFields.direct.default(true),
  drafts: inboxFields.drafts.default(false),
  bots: inboxFields.bots.default(false),
  mute: inboxFields.mute.default([]),
  limit: inboxFields.limit.default(10),
});

const inboxKv = () => createNamespaceKv("CODE_REVIEWS");

export async function inboxSettings(): Promise<ReviewInboxSettings> {
  const parsed = inboxSettingsSchema.safeParse((await inboxKv().get("inbox")) ?? {});
  return parsed.success ? parsed.data : inboxSettingsSchema.parse({});
}

export async function saveInboxSettings(
  change: Partial<ReviewInboxSettings>,
): Promise<ReviewInboxSettings> {
  const next = inboxSettingsSchema.parse({ ...(await inboxSettings()), ...change });
  await inboxKv().set("inbox", next);
  return next;
}

function muted(settings: ReviewInboxSettings) {
  const words = settings.mute.map((w) => w.toLowerCase());
  const authors = new Set(words.filter((w) => w.startsWith("@")).map((w) => w.slice(1)));
  const titles = words.filter((w) => !w.startsWith("@"));
  return (pr: { title: string; author: string }) =>
    authors.has(pr.author.toLowerCase()) ||
    titles.some((word) => pr.title.toLowerCase().includes(word));
}

export async function reviewInbox(query: InboxQuery = {}): Promise<InboxPullView[]> {
  const [projects, settings] = await Promise.all([db.select().from(codeProjects), inboxSettings()]);
  const repo = query.repo ?? (settings.repos === "projects" ? "projects" : undefined);
  const filter: InboxFilter = {};
  if (query.days) {
    filter.updatedSince = new Date(Date.now() - query.days * 86_400_000).toISOString().slice(0, 10);
  }
  if (repo === "projects") {
    if (projects.length === 0) return [];
    filter.repos = projects.map((p) => ({ owner: p.repoOwner, name: p.repoName }));
  } else if (repo) {
    const ref = parseRepo(repo);
    if (!ref) throw Boom.badRequest(`Not a repository: ${repo}`);
    filter.repos = [ref];
  }
  if (query.drafts === "hide" || !settings.drafts) filter.drafts = false;
  if (settings.direct) filter.direct = true;
  const github = await codeGitHub().client();
  let pulls;
  try {
    pulls = await github.reviewInbox(filter);
  } catch (error) {
    throw Boom.badRequest(
      `Cannot read your review requests on GitHub: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const open = await db.select().from(codeReviews).where(isNull(codeReviews.archivedAt));
  const projectOf = new Map(
    projects.map((p) => [`${p.repoOwner}/${p.repoName}`.toLowerCase(), p.id]),
  );
  const reviewOf = new Map(open.map((r) => [`${r.projectId}#${r.number}`, r.id]));
  const isMuted = muted(settings);
  const kept = pulls.filter((pr) => (settings.bots || !pr.bot) && !isMuted(pr));
  return kept.map((pr) => {
    const projectId = projectOf.get(repoSlug(pr.repo).toLowerCase()) ?? null;
    const section: InboxPullView["section"] =
      pr.reason === "requested"
        ? "needs"
        : pr.reason === "authored"
          ? "mine"
          : pr.lastReview?.commit && pr.lastReview.commit !== pr.headSha
            ? "updated"
            : "waiting";
    return {
      section,
      repo: repoSlug(pr.repo),
      number: pr.number,
      title: pr.title,
      url: pr.url,
      author: pr.author,
      draft: pr.draft,
      updatedAt: pr.updatedAt,
      decision: pr.decision,
      lastReviewAt: pr.lastReview?.at ?? null,
      projectId,
      reviewId: projectId ? (reviewOf.get(`${projectId}#${pr.number}`) ?? null) : null,
    };
  });
}
