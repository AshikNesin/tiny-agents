/**
 * @tiny-agents/github: one GitHub client for Code (issue #297 §7, ADR 0022)
 * over two transports. The `gh` transport runs `gh api` on the sandbox
 * through an exec port the caller passes in; the HTTPS transport calls
 * GitHub from the app server with a token the vault releases.
 *
 * It imports neither pi-durable, `@tiny-agents/agent` nor
 * `@tiny-agents/sandbox` (lint R11), and uses Web APIs only.
 */
export { GitHubError, graphQlData, type GitHubApi, type HttpMethod } from "./api";
export { createGhTransport, type ExecPort, type ExecResult } from "./gh-transport";
export {
  convertManifest,
  createAppAuth,
  verifyWebhook,
  type AppAuth,
  type AppAuthOptions,
  type ManifestApp,
} from "./app-auth";
export { createHttpsTransport, type HttpsTransportOptions } from "./https-transport";
export {
  checkOf,
  createGitHubClient,
  parseRepo,
  repoSlug,
  toSnapshot,
  type Association,
  type Author,
  type AuthorType,
  type Check,
  type CheckState,
  type GitHubClient,
  type IssueComment,
  type MergeMethod,
  type PullRef,
  type PullSnapshot,
  type RepoRef,
  type Review,
  type ReviewComment,
  type ReviewThread,
} from "./client";
