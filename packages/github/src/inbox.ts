import { z } from "zod";
import { each, type ReportInvalid } from "./parse";
import { repoSlug } from "./repo";
import type { InboxFilter, InboxPull } from "./types";

const INBOX_PULL = `fragment InboxPull on PullRequest {
  number title url isDraft updatedAt headRefOid reviewDecision
  repository { owner { login } name }
  author { login __typename }
  reviews(author: $login, last: 1) { nodes { submittedAt commit { oid } } }
}`;

export const INBOX_QUERY = `query ReviewInbox($login: String!, $requested: String!, $reviewed: String!, $authored: String!) {
  requested: search(query: $requested, type: ISSUE, first: 50) { nodes { ...InboxPull } }
  reviewed: search(query: $reviewed, type: ISSUE, first: 50) { nodes { ...InboxPull } }
  authored: search(query: $authored, type: ISSUE, first: 50) { nodes { ...InboxPull } }
}
${INBOX_PULL}`;

const BOT_LOGIN = /(?:[-_]bot|\[bot\])$/i;

const isBotAuthor = (author: { login: string; __typename?: string } | null) =>
  author?.__typename === "Bot" || (author ? BOT_LOGIN.test(author.login) : false);

const INBOX_SEARCHES = {
  requested: "review-requested:@me",
  reviewed: "reviewed-by:@me -author:@me",
  authored: "author:@me",
} as const;

const SEARCH_MAX = 256;

export function inboxSearches(filter: InboxFilter): Record<keyof typeof INBOX_SEARCHES, string> {
  const narrow = [
    filter.updatedSince ? `updated:>=${filter.updatedSince}` : "",
    filter.drafts === false ? "draft:false" : "",
  ].filter(Boolean);
  const repos = (filter.repos ?? []).map((r) => `repo:${repoSlug(r)}`);
  const searches: Record<keyof typeof INBOX_SEARCHES, string> = filter.direct
    ? { ...INBOX_SEARCHES, requested: "user-review-requested:@me" }
    : INBOX_SEARCHES;
  const build = (who: string, withRepos: boolean) =>
    [
      "is:open is:pr archived:false",
      who,
      ...narrow,
      ...(withRepos ? repos : []),
      "sort:updated-desc",
    ].join(" ");
  const out = {} as Record<keyof typeof INBOX_SEARCHES, string>;
  for (const [key, who] of Object.entries(searches) as Array<
    [keyof typeof INBOX_SEARCHES, string]
  >) {
    const full = build(who, repos.length > 0);
    out[key] = full.length <= SEARCH_MAX ? full : build(who, false);
  }
  return out;
}

const rawInboxPullSchemaOf = (report: ReportInvalid) =>
  z.looseObject({
    number: z.number(),
    title: z.string(),
    url: z.string(),
    isDraft: z.boolean(),
    updatedAt: z.string(),
    headRefOid: z.string(),
    reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]).nullable(),
    repository: z.looseObject({ owner: z.looseObject({ login: z.string() }), name: z.string() }),
    author: z.looseObject({ login: z.string(), __typename: z.string().optional() }).nullable(),
    reviews: z.looseObject({
      nodes: each(
        "a pull request's review",
        report,
      )(
        z.looseObject({
          submittedAt: z.string().nullable(),
          commit: z.looseObject({ oid: z.string() }).nullable(),
        }),
      ),
    }),
  });

const notAPull = (): null => null;

const inboxNodesSchemaOf = (report: ReportInvalid) =>
  z.looseObject({
    nodes: each(
      "a review inbox entry",
      report,
    )(z.union([rawInboxPullSchemaOf(report), z.strictObject({}).transform(notAPull)])),
  });

export const inboxSchemaOf = (report: ReportInvalid) =>
  z.looseObject({
    requested: inboxNodesSchemaOf(report),
    reviewed: inboxNodesSchemaOf(report),
    authored: inboxNodesSchemaOf(report),
  });

export function inboxPulls(
  data: z.infer<ReturnType<typeof inboxSchemaOf>>,
  filter: InboxFilter,
): InboxPull[] {
  const keep = filter.repos?.length
    ? new Set(filter.repos.map((r) => repoSlug(r).toLowerCase()))
    : null;
  const seen = new Set<string>();
  const out: InboxPull[] = [];
  for (const reason of ["requested", "reviewed", "authored"] as const) {
    for (const node of data[reason].nodes) {
      if (!node) continue;
      const slug = `${node.repository.owner.login}/${node.repository.name}`;
      if (keep && !keep.has(slug.toLowerCase())) continue;
      const key = `${slug}#${node.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const last = node.reviews.nodes[0];
      out.push({
        reason,
        repo: { owner: node.repository.owner.login, name: node.repository.name },
        number: node.number,
        title: node.title,
        url: node.url,
        author: node.author?.login ?? "ghost",
        draft: node.isDraft,
        updatedAt: node.updatedAt,
        headSha: node.headRefOid,
        decision: node.reviewDecision
          ? (node.reviewDecision.toLowerCase() as InboxPull["decision"])
          : null,
        lastReview: last?.submittedAt
          ? { at: last.submittedAt, commit: last.commit?.oid ?? null }
          : null,
        bot: isBotAuthor(node.author),
      });
    }
  }
  return out;
}
