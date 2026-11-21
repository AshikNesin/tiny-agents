# 0032 — Decisions recorded from code comments: server and scripts

- Status: accepted
- Date: 2026-11-20

## Context

The comment sweep under [ADR 0028](./0028-code-carries-no-comments.md)
removed every comment from `apps/web/src/server` (outside `api/`),
`apps/web/src/shared`, `scripts`, `site` and the root build and test configs.
Most were tautologies. The decisions below were the ones a careful engineer
could not get back from the code, its tests, the guides or an earlier ADR, so
they move here.

## The lint generator's one entry per file (`scripts/lint/boundaries.ts`)

Oxlint does not merge two overrides that set the same rule on one file: the
later override replaces the earlier. The generator therefore gives every file
exactly one `no-restricted-imports` entry that holds every import row applying
to it. Splitting rows into separate overrides would silently drop all but the
last.

## Why each lint exception exists (`scripts/lint/boundaries.ts`)

Every entry in a rule's `except` list or allowlist is a narrow, argued
exception:

- `DRIVER_HOMES` (R8a): `scripts/demo/launch/tools/**` may open a driver
  because the launch film's staging scripts seed a throwaway instance's own
  database under `data/verify/<area>/app.db`, never the app's.
  `packages/agent/src/lock.ts` imports a file lock for the agent store, not a
  database driver.
- `R12_ALLOWED` names module state that stays out of the App root. The caches
  are derived from durable state, safe to lose and rebuilt on a miss: the
  HKDF keys derived from the master secret (`crypto/secret-box.ts:derived`),
  the vault's backend health and resolved app credentials (TTL-bound), the
  backends built from config on first use and their item listing (TTL-bound),
  extracted attachment text, the image processor loaded once, the
  `SANDBOX_SSH_KEY_FILE` contents read once per path, the per-server WebSocket
  upgrade paths and the driver behind each db instance (both keyed weakly).
  The uploads extraction queue is the work state of one module, drained on
  idle. `entry.node.ts:captureException` is the Sentry slot, set before the
  App root exists. The remaining entries are constant Sets, never written
  after they are built.
- R3 (`process.env`): `entry.node.ts` loads `.env` and hands `process.env` to
  `bootstrap()` and the agent runtime; `db/open.ts` sets the production
  `DATABASE_URL` default before `bootstrap()` validates env; the Claude
  worker's `bin.ts` runs on the sandbox VM, outside the app's env; and
  `coding-ops.ts` hands the worker's environment to git with three overrides
  and reads no key.
- R8b: `apps/web/src/server/db/index.ts` reads `core.db` through a namespace
  import, which the rule cannot tell from a `setDb` import.
- R9: `sessionInvalid` is module-private in `packages/core/src/session`, but
  its code is public in `ErrorCode`, so a hand-built error elsewhere still
  needs the rule. The session guard, the errors module that defines the code
  and the shell client that signs the owner out on it are the exceptions.
- R15: `use-live-changes.ts` and `use-thread.ts` are SSE streams, not
  request/response loads; only the stream's path is built in the effect.

## Boot order and serving (`apps/web/src/server/entry.node.ts`)

- `/health` answers 503 until the agent store is open and resumed, so an
  orchestrator never routes traffic to a half-booted server.
- pi-durable's error rules: a storage error ends the Harness, so the process
  exits and the orchestrator restarts it and `resume()` picks the work back
  up; a throwing hook, listener or tool result is only reported.
- Part order beyond what `needs` checks: the sandbox SSH connection starts
  first so it stops last, after the runtime, browsers and desktops ran their
  teardown over it. Browsers stop before the runtime and after everything that
  could still ask for a page. The HTTP server starts last and stops first: new
  connections are refused and long-lived ones (SSE, VNC and terminal sockets)
  are ended so `close()` can finish while everything they use is still up.
  The supervisor's "ready" message is sent last, so it means everything
  started. Remote MCP connections and routine re-arming run in the background
  and never block boot or `/health`.
- The HTTP server is created without listening (unlike `serve()`), so
  WebSocket upgrade handlers attach before it listens exactly once.
- In production a missing build file under the asset paths returns 404, never
  `index.html` with a 200: a stale tab importing an old chunk would run HTML
  as JavaScript, and a CDN would cache that HTML under the asset's URL. Hashed
  assets are cached forever; everything else revalidates.

## Database schema choices (`apps/web/src/server/db/schema.ts`)

- Field names match the Prisma models the tables replaced (camelCase in code,
  snake_case columns), and text ids keep the cuid shape of rows Prisma
  created, so the pre-Drizzle copy (`db/legacy-copy.ts`) maps columns by name.
- `connections.secretItemId` has no foreign key: drizzle-kit adds the
  column without its `ON DELETE`, and a deleted item already reads like a
  `secretRef` to a deleted handle.
- `llm_calls` (side-calls) holds trace metadata only, never the prompt or the answer; a
  conversation's own calls are read from its entries in agent.db.

## Changeset gate rules (`scripts/check-changesets.mjs`)

- A kit package's `package.json` edit needs coverage when any top-level key
  other than `name`, `version` and `private` changes. It is a denylist on
  purpose: an allowlist would let a new publishing-relevant key slip through,
  and would make "unlisted" mean "safe". `version` is excepted because the
  release bot owns it and its commits are exempt by author.
- Only a changeset or reason the branch adds counts as coverage; an edit or a
  rename does not. An edited changeset is still checked, because one unknown
  package name fails `changeset status` and the Release workflow.
- Release reasons live in `.no-release/`, outside `.changeset/`:
  `@changesets/read`'s legacy reader treats any directory there as an
  old-format changeset and fails the Release workflow with ENOENT.
- Manifests are read as real blobs from git, not reconstructed from a diff: a
  diff carries only the lines around each hunk, so a partial JSON manifest
  cannot be parsed.
- In a child project, `packages/**` and `.groot/**` arrive by sync and are
  versioned by groot, so the child's gate covers only what it owns.

## Build and test configuration (`vite.config.ts`, `vitest.config.server.ts`, `playwright.config.ts`)

- Tailwind runs as the Vite plugin, not `@tailwindcss/postcss`: under PostCSS,
  Vite rewrote `url()`s after Tailwind had inlined `@import`s and lost their
  source files, so `@fontsource`'s relative font files 404'd to `index.html`
  in production.
- The `@groot/*` and `@` aliases are defined once and shared by the build and
  the client test runner, so the two never resolve different module shapes.
- `CHANGELOG.md` files are excluded from formatting: changesets emits a blank
  line between a header and its list, Oxfmt collapses it, and the release
  workflow commits with hooks off, so every version merge would fail the
  format check. `mobile/` is linted and formatted by its own boilerplate's
  tooling, and vendored skill and kit code is linted where it comes from.
- Server suites that type-check whole copies of the repo in child processes
  run as their own group after the rest: alongside other tests they starved
  CI's runner and unrelated tests hit their 5-second timeout.
- The server test config strips service keys and model settings from the
  environment, matching CI: with real Pushover keys exported, the
  notification route tests once sent real pushes.
- Playwright starts the server through tsx directly, bypassing the `pnpm dev`
  portless wrapper, which conflicts with Playwright's port check. It runs on a
  throwaway SQLite file with the faux model, one worker, and a raised sign-in
  rate limit because every test signs in from 127.0.0.1.

## Repository check scripts (`scripts/check-*.ts`, `scripts/check-*.mjs`)

- AST scripts (`check-old-modules.ts`, `check-kit-exports.ts`,
  `check-typecheck-coverage.ts`, `codemods/remove-dead-code.ts`) import the
  TypeScript 6 package: TypeScript 7, the native compiler, ships no classic JS
  API.
- `check-typecheck-coverage.ts` typechecks repo-owned `.d.ts` files in a pass
  of its own, one program per checked config, because both tsconfigs set
  `skipLibCheck` and the two disagree on lib and DOM types. Diagnostics are
  requested per repo-owned file so third-party declarations stay
  `skipLibCheck`'s job.
- `check-pnpm-policy.ts` parses `pnpm-workspace.yaml` with a line scanner, not
  a YAML library, so it has no dependencies and can run before any install.
  `trustPolicyExclude` entries must be exact `name@version` pins; a wildcard
  exempts every future version.
- `check-runtime-closure.mjs` reads the real esbuild metafile, never the
  source text. `vite` is the one dev-only exemption: the server imports it
  dynamically only outside production.
- `check-doc-refs.mjs` skips absolute paths: they name the machine, not the
  repo, and make `git check-ignore` exit fatally.
- `check-design-tokens.ts` is a ripgrep script because Oxlint cannot ban
  string patterns inside `className`. A surface counts as a hand-rolled Card
  only when it is `rounded-`, which keeps square full-bleed chrome such as the
  sidebar out of the match.
- `lib/merge-base.mjs` fetches into an explicit destination, because a
  single-branch shallow clone only fills `FETCH_HEAD` on `git fetch origin
  main`.
- `changelog.cjs` wraps `@changesets/changelog-github` and falls back to plain
  lines when GitHub's GraphQL API fails, so a GitHub outage never blocks a
  release.

## `pnpm local` releases (`scripts/lib/local-releases.ts`, `scripts/dev.ts`)

- Release worktrees live outside the checkout so editors and tools never scan
  them. Folders are deleted in parallel, but git commands on one repository
  stay serial because they share its lock files.
- A release build never inherits the server's `NODE_ENV`: it builds for
  production but needs dev dependencies.
- The server runs in its own process group, so Ctrl+C reaches only the
  supervisor, which stops the server once (a second signal would skip its
  graceful shutdown). The server is killed if the supervisor goes away,
  because it holds the agent store's lock.
- `pnpm dev` gives the server about 600 MB of heap: the groot default of 512
  OOM-crashed it on startup (issue #121).

## Launch film and demo tooling (`scripts/demo/**`)

- Staging pages get a quiet Vite HMR socket: the dev server reloads every tab
  whenever a file in the repo changes, and the staging scripts write snapshot
  files there. `stage-travel.mjs` points the socket at a closed port instead,
  because Playwright's `routeWebSocket` shim breaks noVNC's stream.
- Staging pages refuse the third-party feedback embed, so its launcher never
  enters a frame.
- The film scrubs each scene through a plain number, not by tweening the
  timeline's `time`: GSAP undoes a `fromTo`'s start value on rewind, which sent
  the scene back to 0, and a scene is never set to exactly 0 for the same
  reason. Scenes are laid out while displayed (an undisplayed element measures
  as nothing), and scrolled panes are moved by a transform because a scroll
  offset is lost whenever its element is undisplayed.
- The film's stylesheet drops transitions and animations (they run on the
  browser's clock) and keeps each rule once, because a render restyles every
  frame. GSAP is kept beside the film so a render never waits on a CDN.
- The teaser renderer gives each worker its own browser: Chromium throttles
  background tabs, so pages sharing one browser stall each other.

## The site's demos (`site/demos/**`)

- `site/demos/vite.config.ts` builds the demos into `site/assets/`, which is
  committed, so the site stays a static folder with no build step.
- `parts.ts` imports kit parts file by file: the kit's index re-exports its
  brand-mark registry, which cannot be tree-shaken and would add about 90 KB.
- `Face.tsx` inlines the Travel Planner mark because the stage renders outside
  the page's `<use>` sprite.
