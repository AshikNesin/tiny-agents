# @groot/shell

## 1.3.0

### Minor Changes

- [#139](https://github.com/AshikNesin/tiny-agents/pull/139) [`ea8011c`](https://github.com/AshikNesin/tiny-agents/commit/ea8011cae6f77836511661722567a1c72f21f9e8) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add first-run setup: create the first user from the browser at `/setup`.
  
  `@groot/core` adds `GET /api/v1/auth/setup` (`{ needsSetup }`) and
  `POST /api/v1/auth/setup`, which creates the first account and signs it in
  (cookie + token, like login). It answers 403 once any user exists and is
  rate-limited like login. The service gains `hasAnyUser()` and
  `createFirstUser()`; the schema exports `SetupStatus`.
  
  `@groot/shell` adds the `Setup` page (`@groot/shell/pages/auth/Setup`), the
  `useSetupStatus()` hook and the store's `setup()` action. `Login` redirects to
  `/setup` while no user exists, and `Setup` redirects to `/login` once one
  does. Apps mount it with `<Route path="/setup" element={<Setup />} />`.

### Patch Changes

- [#137](https://github.com/AshikNesin/tiny-agents/pull/137) [`a0fb7fd`](https://github.com/AshikNesin/tiny-agents/commit/a0fb7fdb53bca28ae63c984f6356cfefb33345da) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Rebuild the remaining kit components on Fluid Functionalism's design, with
  their APIs unchanged. New `@groot/ui/motion` entry exports the shared
  `spring` tiers, `useModalPresence` and `FluidHighlight`.
  
  - `TabsList` slides its selected pill (or `line` underline) between tabs and
    shows a hover pill.
  - `Tooltip` is an inverted chip that springs in and fades out; the provider's
    delay drops to 200ms.
  - `Select`, `DropdownMenu` and the command menu share one gliding row
    highlight and a softer popup entrance; the picked select row is medium weight.
  - The command menu gets a borderless search line, brightening rows and a new
    `CommandFooter` of keyboard hints (hidden on touch); `CommandDialog` and the
    shell palette open top-anchored at `lg` width.
  - In the app: the switch thumb springs, stretches, squashes and can be
    dragged; owner messages are a soft tinted bubble and bot replies plain text,
    with time and copy in a hover row (always shown on touch) and a spring
    entrance for new messages; the composer has Fluid's ring frame and a
    send/stop button that morphs between states.
- Updated dependencies [[`ea8011c`](https://github.com/AshikNesin/tiny-agents/commit/ea8011cae6f77836511661722567a1c72f21f9e8), [`248cb33`](https://github.com/AshikNesin/tiny-agents/commit/248cb33c6853447e1befd09d02ec0e16e543e5dc), [`a0fb7fd`](https://github.com/AshikNesin/tiny-agents/commit/a0fb7fdb53bca28ae63c984f6356cfefb33345da)]:
  - @groot/core@1.2.0
  - @groot/ui@0.10.0

## 1.2.0

### Minor Changes

- [`a6a4e79`](https://github.com/AshikNesin/tiny-agents/commit/a6a4e79fded85cb2fa1e7bbd2c3560555ea07ea7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - `apiClient` takes per-request options. Every verb accepts a trailing
  `{ headers }`, and `apiClient.request(method, path, { params, body, headers,
  emptyOk })` covers the rest: extra headers such as a step-up token or an
  idempotency key, and `emptyOk` for an endpoint that may answer with no data
  (as `delete` always allowed). Apps no longer need a second copy of the
  client's 401 handling and `ApiError` parsing to send one header.

- [#104](https://github.com/AshikNesin/tiny-agents/pull/104) [`0826ecb`](https://github.com/AshikNesin/tiny-agents/commit/0826ecbc3ea7c3e68fa93bb00648688d53cb0b81) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Move to groot 3.0: Hono instead of Express, Drizzle on SQLite instead of
  Prisma, a table-backed job queue instead of honker, code config instead of
  config.yml and varlock. tiny-agents stays on Node (Chromium, ssh2 and the
  pi-durable store run in-process).
  
  - **Your data moves over on the first boot.** A database from the Prisma
    build is renamed to `app.db.prisma-backup-<time>` and every row is copied
    into the new layout: users, passkeys, bots, past chats, skills, connections,
    messages, tasks, vault items and audit events, uploads, routines and runs,
    memories, the notification log, and key-value settings (local vault
    secrets, SSH host keys, app and notification settings). Routines re-arm
    their next run on boot.
  - **Existing passwords keep working.** A bcrypt hash from the old build is
    accepted once and replaced with a PBKDF2 hash on that sign-in. Vault
    step-up accepts both.
  - **Uploads persist across redeploys.** They now live beside the database
    (`/app/data/uploads` with the current volume) instead of `./local/uploads`
    in the container; files still in the old folder are copied over.
  - The groot 3.0 UI refresh comes along: one control height scale, rounder
    surfaces, toasts that follow dark mode, CodeMirror on the theme tokens, and
    the warm palette now lives in the shell (app.css keeps only chat tokens).
  - Fixes found on the way: a bot edit that only changed its skills or
    connections returned 500 under Drizzle; the login page showed the raw error
    instead of "Invalid email or password" with the fetch client; a server
    error message without a code (the terminal's, for one) was replaced by the
    generic fallback. `ApiError` now carries `fromServer` to tell the two apart.

- [#48](https://github.com/AshikNesin/tiny-agents/pull/48) [`bbf5163`](https://github.com/AshikNesin/tiny-agents/commit/bbf5163dae529c1fd7ee8f79dfd65003c89014fc) Thanks [@AshikNesin](https://github.com/AshikNesin)! - `ShellConfig.openNav` lets an app with `pageChrome: "sidebar"` open its own
  navigation from every page: phones get one menu button where the back button
  and profile circle were, while pages that pass the new `PageLayout` /
  `TopBar` `backTo` keep a back button to their parent. On phones the page
  description now sits under the title, above the action row, and on desktop
  the title row has the same height with or without actions, so headers no
  longer shift between pages.

- [#60](https://github.com/AshikNesin/tiny-agents/pull/60) [`371f766`](https://github.com/AshikNesin/tiny-agents/commit/371f766487b4800ad9c228326012f471822ebf94) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Push notifications via Pushover (issue [#57](https://github.com/AshikNesin/tiny-agents/issues/57)). `@groot/core/notification` replaces the `send-push-notification` wrapper with a small fetch client (`pushover.ts`) behind a channel port (`notifier.ts`) and a `NotificationService` whose `notify()` never blocks or throws: per-event switches, dedupe backed by the new `NotificationLog` table (so replays after a restart stay quiet), coalescing with cancel-on-resolve, quiet hours with a digest, throttling (30/h, 5/min per bot) with one "suppressed" summary, retries for transient failures only, and the 429/invalid-credentials channel states. Free text is scrubbed (`scrub.ts`: links, registered redactors, secret-looking runs, length caps). Settings live in the `notifications` app setting; `/api/v1/notifications` serves status, settings, a test send, re-validation and the log, and Settings gains a Notifications tab (`@groot/shell`). The agent's `WaitTracker` reports each waiting call (`onTransition`, with the tool and a preview) and `AgentRuntime.onWait` exposes it. App side: approvals, questions (plus one reminder), failed and long replies while the chat is closed, and routine results, misses and pauses push with deep links (`/chats/:botId?focus=approval:<task>` scrolls to the card); the startup ping becomes a silent `system.started`. Vault approvals name the item and target host, credential requests push to `/vault/requests/:task` and expire with the request, the vault's reveal/delete/refused-fill alerts become the locked `vault.alert` security event, and the vault's secret redactor scrubs every push (`WaitInfo` gains `subject` and `expiresAt`).

- [`d419bdf`](https://github.com/AshikNesin/tiny-agents/commit/d419bdf388ac5b583b7329a3ef88cb3e7f1f321a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add TopBar + ProfileButton (Grok-style floating page chrome) and render
  it from PageLayout. ShellConfig gains `nav` rows for the profile menu.

### Patch Changes

- [#51](https://github.com/AshikNesin/tiny-agents/pull/51) [`f1e3914`](https://github.com/AshikNesin/tiny-agents/commit/f1e39146a6cd72b104b41a905080fea52a9a340c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bump dependencies, including `@earendil-works/pi-durable`, `pi-ai`, and `chord` to 1.4.0. Document definitions pass `checkpointWhen: () => false` so ordinary changes stay deltas. Sentry 11, files-sdk 3, and SimpleWebAuthn 14 needed small call-site updates.

- [`a111ade`](https://github.com/AshikNesin/tiny-agents/commit/a111ade11c5551a018328c218b34f4807f0c3b70) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix the login demo-credentials spacing and report failed message-copy attempts.

- [`046443a`](https://github.com/AshikNesin/tiny-agents/commit/046443a45d56e86449b241eea4a9c924a2b5ee22) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Rounder, taller Grok-style controls: larger corner radius, 36px default buttons and 40px inputs/selects, 2xl cards, 3xl dialogs with a flat footer, and a lighter dialog overlay. In sidebar mode the page title is larger and Settings uses the same 5xl width as other pages.

- [#46](https://github.com/AshikNesin/tiny-agents/pull/46) [`1b4cf57`](https://github.com/AshikNesin/tiny-agents/commit/1b4cf574edbd0a20f4cddae400b32f7419c617f3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - `PageLayout` passes page actions to the new `TopBar` `actions` slot: they
  close the title row on desktop and wrap to their own row under it on
  phones, instead of squeezing beside a multi-line description. The slot
  follows the profile circle in the DOM, so focus order matches the layout.

- [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Gitleaks' two generic rules now match quoted literal values only, so ordinary code (`password: z.string()`, `const token = makeToken()`) no longer blocks commits; the demo login's credentials carry an inline `gitleaks:allow`. Sync tooling: a malformed conflict manifest or `boilerplate-sync.json` is reported as such instead of being treated as "nothing pending" / "not found"; `package.json` without a sync baseline is merged instead of getting conflict markers. `groot:setup` rejects names that give no usable slug, renames the Worker whatever its current name, and no longer breaks on `|`, `&` or `\` in the app name.

- [#27](https://github.com/AshikNesin/tiny-agents/pull/27) [`3944039`](https://github.com/AshikNesin/tiny-agents/commit/39440393d04314b7cd9e8afbf5f8fb72105d0a2d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add optional `ShellConfig.pageChrome` (`"floating"` | `"sidebar"`). With `"sidebar"`, the top bar hides its back and profile buttons at md+ for apps that render their own sidebar. The shell theme also maps the chat surface tokens (`bubble`, `composer`, `fg-tertiary`, `link`) to Tailwind colors.

- [`c760f77`](https://github.com/AshikNesin/tiny-agents/commit/c760f77e0919d0b7fccd44a68894889560833a7b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Storage rows show "-" in the Modified column for folders, matching the
  Size column, instead of formatting the service's epoch sentinel as
  1970-01-01.
- Updated dependencies [[`8af6c00`](https://github.com/AshikNesin/tiny-agents/commit/8af6c000505b5cc575993db964318ae25f439086), [`5bc76f2`](https://github.com/AshikNesin/tiny-agents/commit/5bc76f2e8a00227cc331067a8b4ed825fb1af8bf), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`f1e3914`](https://github.com/AshikNesin/tiny-agents/commit/f1e39146a6cd72b104b41a905080fea52a9a340c), [`16cfe00`](https://github.com/AshikNesin/tiny-agents/commit/16cfe00b63d9d8ffb29efc4e058d0290dc6e2b40), [`16cfe00`](https://github.com/AshikNesin/tiny-agents/commit/16cfe00b63d9d8ffb29efc4e058d0290dc6e2b40), [`046443a`](https://github.com/AshikNesin/tiny-agents/commit/046443a45d56e86449b241eea4a9c924a2b5ee22), [`0826ecb`](https://github.com/AshikNesin/tiny-agents/commit/0826ecbc3ea7c3e68fa93bb00648688d53cb0b81), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`371f766`](https://github.com/AshikNesin/tiny-agents/commit/371f766487b4800ad9c228326012f471822ebf94), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`9029da7`](https://github.com/AshikNesin/tiny-agents/commit/9029da718a59d989f03a27e9a581d81244cf6698)]:
  - @groot/core@1.1.0
  - @groot/ui@0.9.0

## 1.1.0

### Minor Changes

- [#140](https://github.com/AshikNesin/groot/pull/140) [`68254db`](https://github.com/AshikNesin/groot/commit/68254db6c9f7f4378a93cb8f5c89746877295bb2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - New default look: a warm monochrome theme, ported from tiny-agents, applied consistently across every primitive and page. Every app that syncs `packages/**` picks it up, so review your pages after syncing. The rules are in `docs/features/dls.md` ("Shape and size").

  - **Theme tokens** (`@groot/shell` `index.css`): off-white / near-black surfaces with a faint warm cast, foreground-derived hairline borders, an achromatic primary, and a larger `--radius` (0.75rem). In dark mode `--muted` and `--secondary` sit one step above `--card`, so hover and selected fills show on cards. The sidebar tokens now hold real values (the sidebar uses them). Each theme sets `color-scheme`, the body uses `100dvh`, and scrollbars get a quiet thumb. CodeMirror's background, gutter and active line follow the tokens.
  - **One control scale** (`@groot/ui`): `Button`, `Input`, `SelectTrigger`, `InputGroup` and `TabsList` share heights (`sm` h-7, default h-9, `lg` h-10) and are `rounded-xl` at every size. `Button` default is h-9, `lg` h-10, `icon` size-9, `icon-lg` size-10; `Input` and `InputGroup` are h-9. Outline buttons are transparent, so they take the surface they sit on.
  - **Surfaces**: `Card` `rounded-2xl`. `Dialog` and `AlertDialog` (and so `useConfirm`) are viewport-capped flex columns, `rounded-3xl` with `p-6`, over a `bg-black/40` backdrop without blur; their footers drop the grey band and negative margins, so drop any compensating spacing. New `DialogBody` scrolls tall content between a pinned header and footer. Dropdown menus and the select menu are `rounded-xl` with `rounded-lg`, roomier items; the command palette uses the dialog radius; tooltips `rounded-lg`; `Alert` `rounded-xl`; toasts `rounded-xl`.
  - **Toasts follow the theme**: `Toaster` reads the `dark` class on `<html>`, so rich-color toasts are no longer light on a dark page.
  - **Contrast**: destructive text on `Badge` and `StatusBadge` mixes in the foreground so it reaches 4.5:1 on its red tint.
  - `GrootUIProvider` takes a `toaster` prop (sonner `ToasterProps`, e.g. `position`).
  - **Shell chrome**: `SidebarNav` uses the sidebar tokens, a hairline border and `h-9 rounded-xl` rows; the collapsed rail now keeps search and the account menu. The page background is `bg-background` instead of `bg-muted/40`, and the mobile top bar is opaque. Settings search, list rows, the new-setting form and the JSON editor frame follow the control scale; the storage table frame matches `Card`. `ThemeMenu` is exported from `@groot/shell/components/Layout`.
  - **`@groot/jobs`**: page-header and job-detail actions use the default size; the filter toolbar (tabs, search, Queue, Date) is one height; the job type picker looks like a select; job dialogs scroll their forms in `DialogBody`; JSON, log and error blocks are `rounded-xl`.

### Patch Changes

- Updated dependencies [[`68254db`](https://github.com/AshikNesin/groot/commit/68254db6c9f7f4378a93cb8f5c89746877295bb2)]:
  - @groot/ui@0.8.0

## 1.0.0

### Major Changes

- [#135](https://github.com/AshikNesin/groot/pull/135) [`6002a46`](https://github.com/AshikNesin/groot/commit/6002a46dabe53ab067472cfa03862d18e1d9fcdc) Thanks [@AshikNesin](https://github.com/AshikNesin)! - **@groot/shell:** the API client is now plain `fetch`; axios is gone. `apiClient.client` (the axios instance) no longer exists, and failed requests throw `ApiError` (`status`, `code`, `details`, `url`) instead of an axios error. `error.message` still carries the server's message.

  **@groot/core:** `migrateD1()` applies Drizzle's generated SQL migrations to a D1 database from inside the Worker (wrangler-compatible `d1_migrations` bookkeeping), so the Workers entry migrates on its first request and `wrangler deploy` is the whole deploy. `pnpm db:generate` now also writes `apps/web/drizzle/index.ts`, the list the Worker imports. The unused `send-push-notification` dependency is dropped.

### Patch Changes

- [`c1e5177`](https://github.com/AshikNesin/groot/commit/c1e5177f72bce07990e72f6678a210b62005d472) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix the JSON editor crashing on mount with "Unrecognized extension value in extension set": pnpm overrides now keep one copy of each `@codemirror/*` core package (the root pinned `@codemirror/state` 6.7.0 while `@codemirror/view` resolved 6.7.1). Switch from `@tailwindcss/postcss` to `@tailwindcss/vite` so the Inter font files from `@fontsource-variable/inter` are bundled; under PostCSS their relative `url()`s never resolved and production served `index.html` in their place.

- [`191f6a6`](https://github.com/AshikNesin/groot/commit/191f6a6ea0efe632f8bf8fc3221f81ab01e9d0c9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix the sidebar losing its layout after the switch to `@tailwindcss/vite`: that plugin scans for classes from Vite's root (`apps/web`), so classes used only in `packages/*` were dropped from the CSS. The shell stylesheet now sets Tailwind's source base back to the repo root.

- Updated dependencies [[`6209997`](https://github.com/AshikNesin/groot/commit/620999778ed329ee20b55f810f80b368db158dd4), [`8ab9eee`](https://github.com/AshikNesin/groot/commit/8ab9eeee9b3029330f8f70d06e6cf31b3f3eb42f)]:
  - @groot/ui@0.7.3

## 0.11.0

### Minor Changes

- [`72ce54c`](https://github.com/AshikNesin/groot/commit/72ce54c32d03c89018fddb5487b4b64662953d2c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add ShellProvider so apps can override shared shell branding and login marketing copy without modifying synced shell components.

### Patch Changes

- [`aba55a5`](https://github.com/AshikNesin/groot/commit/aba55a5205f5c05137f1203af639f8b2e5dcd108) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Login and auth UX fixes from a production friction audit:

  - Login failure toast maps 401 to "Invalid email or password." instead of surfacing the raw Axios message ("Request failed with status code 401"); network failures get a friendly line too. Same for passkey sign-in.
  - Logout from the user menu shows a "Signed out" toast.
  - The login page's right brand panel follows dark mode (`dark:bg-card`) instead of rendering a pure-white slab next to the dark form.
  - Dropdown submenus open with a small `sideOffset` so they no longer overlap their parent menu.

  - The command palette now closes on outside click / overlay tap (it opted
    into `dismissOnOutsideClick`); previously only Escape or running a
    command dismissed it.

- [`7b86607`](https://github.com/AshikNesin/groot/commit/7b86607a4147a66373e1e5c3b8457d81e25a50e6) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add a passkey sign-in option to the login page.

- [#132](https://github.com/AshikNesin/groot/pull/132) [`664f989`](https://github.com/AshikNesin/groot/commit/664f989db27179fd61059a1002506c27c8264023) Thanks [@exe-dev-github-integration](https://github.com/apps/exe-dev-github-integration)! - Import `Settings`'s `PageLayout` from the case-safe `@groot/shell/components/layout/index` barrel instead of the deep file. 129a729 fixed a macOS case-collision (bare `@groot/shell/components/layout` resolves to `components/Layout.tsx`) by moving the last two barrel importers to deep paths, which dropped the `layout/index.ts` barrel from every typechecked program and turned the typecheck-coverage guard red (`183/184`). The barrel is documented public kit surface (docs/guides/development.md), so it stays shipped and re-enters the typecheck graph through a real import.

- [`e3614e4`](https://github.com/AshikNesin/groot/commit/e3614e4bce049f0cb71ee28bcb24cfeed05fd110) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add persisted light, dark, and system theme preferences across the shell.

- Updated dependencies [[`aba55a5`](https://github.com/AshikNesin/groot/commit/aba55a5205f5c05137f1203af639f8b2e5dcd108)]:
  - @groot/ui@0.7.2

## 0.10.3

### Patch Changes

- [#123](https://github.com/AshikNesin/groot/pull/123) [`297f957`](https://github.com/AshikNesin/groot/commit/297f957bc0fcda60dcb63deb770bda7860e92b7e) Thanks [@exe-dev-github-integration](https://github.com/apps/exe-dev-github-integration)! - Complete the typecheck graph: add a client typecheck script and CI step, and a coverage guard that fails when a source file belongs to no checked project. Repo-owned `.d.ts` files under the covered roots are typechecked in a dedicated skipLibCheck:false pass instead of counting toward coverage unchecked. The two live fixes touch kit source: the jobs client re-export path in `packages/jobs/src/client/types.ts`, the `cn` import in `packages/shell/src/components/PasskeyManager.tsx`, and the tooltip entry added to the `packages/ui/src/index.ts` barrel (tooltip.tsx existed since e997f40 but was never exported from the barrel before this PR), so the three kit packages carry the same patch as the root.

- Updated dependencies [[`297f957`](https://github.com/AshikNesin/groot/commit/297f957bc0fcda60dcb63deb770bda7860e92b7e), [`73677b0`](https://github.com/AshikNesin/groot/commit/73677b01da2163aca4d8c78c35f637b124a58b5e)]:
  - @groot/ui@0.7.1

## 0.10.2

### Patch Changes

- [`960a9c1`](https://github.com/AshikNesin/groot/commit/960a9c15e059e49b2edcfb837875c9efc399190d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add DLS composition components: DataField/DataFields, StatTile, listRowClass

  Ships the recurring higher-order patterns the DLS audit found hand-rolled across groot and the child projects (nesins-finance-api alone had 9 files of drifting dt/dd display fields; list-row hover treatments appeared in 86 child files).

  - `@groot/ui/display` (new): `DataField` (label/value pair, `dt`/`dd`, meta-label typography) + `DataFields` (responsive 2→4 col grid wrapper). The display counterpart to form-`Field` from `@groot/ui/form`.
  - `@groot/ui/stat-tile` (new): `StatTile` — meta label + optional icon + `statClass` value, with a clickable/active variant for filter-stats (JobsStats' pattern).
  - `@groot/ui/list-row` (new): `listRowClass` / `listRowGridClass` — the interactive list-row treatments as class constants (`tableColumnHeaderClass` precedent; rows stay semantic elements). Unblocks child projects against the new transition-colors gate rule on next sync.
  - Consumers reconciled: JobOverview (local `Field` deleted), JobDetail singleton section, JobsStats (inline tile → `StatTile`), JobsTable (both row variants), ScheduledJobsPanel, Todos, PasskeyManager.
  - Docs: `docs/features/dls.md` gains a composition-components section (with the pull-don't-push doctrine); `docs/features/client.md` rules table extended.

- [`e95a091`](https://github.com/AshikNesin/groot/commit/e95a09100a8459eab096df4d414ba081d8454112) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Introduce the DLS: a closed type scale, Kumo-adapted rules, and enforcement

  Establishes the repo's Design Language System as a written spec plus enforced rules — built on the existing stack (Tailwind v4 + Radix/shadcn + cva), with Cloudflare's Kumo as reference, not dependency.

  - `@groot/ui/typography` (new): `Text` component + exported classes — `titleClass`, `h1Class`, `statClass`, `displayClass`, `monoClass`, `metaLabelClass`. The type scale is now closed; pages never pick `text-*` sizes ad hoc. `tableColumnHeaderClass` now equals `metaLabelClass` (one definition of the meta-label idiom).
  - 4 new gate rules in `scripts/check-design-tokens.ts` (9 total): `tracking-modified` (no `tracking-*`, except `metaLabelClass`), `font-bold` (banned; `font-semibold` is max), `transition-colors-hover` (instant color hover in pages; primitives exempt as the motion layer), `inline-mono-full-step` (inline mono at `text-[0.9em]`). `allow` lists now support directory-prefix entries.
  - Drift reconciled: `tracking-tight` removed from 8 headings; local meta-label copies in jobs → `tableColumnHeaderClass`; inline `font-mono text-sm` → `text-[0.9em]`; `transition-colors/all` removed from 18 page/shell sites (primitives keep theirs). Login h1 uses `h1Class`; marketing h2 uses `displayClass`.
  - Docs: `docs/features/dls.md` (spec + rationale + rejected alternatives); rules table extended in `docs/features/client.md`; AGENTS.md index link.
  - Agent skill: `.agents/skills/groot-dls/SKILL.md` — the distilled non-negotiables for AI sessions.

- Updated dependencies [[`960a9c1`](https://github.com/AshikNesin/groot/commit/960a9c15e059e49b2edcfb837875c9efc399190d), [`e95a091`](https://github.com/AshikNesin/groot/commit/e95a09100a8459eab096df4d414ba081d8454112)]:
  - @groot/ui@0.7.0

## 0.10.1

### Patch Changes

- Updated dependencies [[`9e5602a`](https://github.com/AshikNesin/groot/commit/9e5602a68d11df36357165df982f71cb8d6c2a79)]:
  - @groot/ui@0.6.0

## 0.10.0

### Minor Changes

- [`18e3200`](https://github.com/AshikNesin/groot/commit/18e3200e3a34db550672c49aa2c5683a4f261b11) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Codebase simplification pass — dead code, duplication, API surface

  Audit-driven cleanup, no behavior changes. Verified green across every layer: typecheck, lint, 211 unit tests, full build, 6 e2e tests. All removals were verified to have zero real consumers via import-graph resolution.

  Dead code (~1,300 LOC across 22 files):

  - date/shell lib helpers with zero callers (25→9 date fns; dropped `formatCurrency`, `debounce`, `truncate`, `getInitials`)
  - one-line Prisma pass-throughs in auth/passkey services; never-wired `auth.deleteUser`, `storage.copyFile`, 6 storage DTO aliases
  - vestigial breadcrumb subsystem (zero `addBreadcrumb` callers), dead `createLogger`/`logPerformance`/`parseLimit`/`useBulkUpload`/`todoJobOptions`
  - 4 orphan ui primitives: `alert`, `pagination`, `select`, `tooltip` (423 lines, zero real importers)

  Duplication:

  - The jobs client `Job`/`ScheduledJob` types now alias the server adapter's `QueueJob`/`ScheduledJobInfo` instead of maintaining a second drifting 19-field shape
  - `withJobToast` helper replaces 15 identical try/toast/catch blocks in `useJobs`/`useJobDetail`
  - `TextInputDialog` consolidates the CreateFolder/Rename dialogs

  Also fixes pre-existing breaks on main: the job-logger level gate was typed `pino.LevelWithSilent` (root tsc exited 2), the pretest hook resolved the DEV database when NODE_ENV wasn't set (now `NODE_ENV=test` everywhere; `ensure-test-db.ts` refuses to run when `TEST_DATABASE_URL` is unset), and login + todos e2e specs drifted from the UI copy.

### Patch Changes

- Updated dependencies [[`18e3200`](https://github.com/AshikNesin/groot/commit/18e3200e3a34db550672c49aa2c5683a4f261b11)]:
  - @groot/ui@0.5.0

## 0.9.1

### Patch Changes

- [`d03042b`](https://github.com/AshikNesin/groot/commit/d03042b6798461138fccb5d1881b2f9e80521153) Thanks [@AshikNesin](https://github.com/AshikNesin)! - feat: render job-data links inline within the JSON view

  Replaces the separate Structured/JSON toggle in `JobJsonBlock` with a single
  read-only JSON panel that highlights resolver-matched values as clickable
  links. Link ranges are computed while pretty-printing (`stringifyWithLinks`)
  and rendered as CodeMirror decorations that navigate on click.

  - `JobJsonBlock` no longer toggles between `JobDataView` and raw JSON; it always
    shows JSON with inline link highlights.
  - `CodeMirrorEditor` gains `linkRanges` and `onLinkClick` props to drive
    `Decoration.mark` ranges + click handling, plus a `.cm-json-link` style.

## 0.9.0

### Minor Changes

- [`399ee35`](https://github.com/AshikNesin/groot/commit/399ee35d36a4bae5fcd3df68b481170d6f68da53) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Make the page shell the single owner of page chrome, and adopt the shared primitives across shell pages.

  - **`PageHeader` / `PageLayout` gain `breadcrumb` and `titleAdornment` slots**, and `description` widens from `string` to `ReactNode`. Detail pages previously copy-pasted `PageHeader`'s `<h1>` classes because there was nowhere to put a breadcrumb trail or a status pill.
  - **`Section` gains `meta` and `actions` slots** and now renders a `text-sm` heading, matching the "label + count" pattern that pages were hand-rolling. It had no consumers before.
  - **`Storage` now renders through `PageLayout`**, dropping its own `max-w-7xl` container and `text-2xl font-medium` `<h1>` (which disagreed with every other page title). Its breadcrumb uses the `Breadcrumb` primitive and its file list uses `Table`/`TableRow`/`TableCell` instead of a raw `<table>`.
  - **`AppSettings` and `PasskeyManager` now use `Card`** instead of hand-rolled `rounded-xl border border-border bg-card` divs, so the Settings page no longer has visibly different card edges than the rest of the app (`Card` uses a ring, not a border).
  - **Destructive confirmations now use `useConfirm()`** in `AppSettings` and `PasskeyManager`, replacing two bespoke `Dialog`s that could be dismissed by an overlay click. `useAppSettings` no longer returns the now-unused `showDeleteDialog` / `setShowDeleteDialog` / `requestDelete`.
  - `ProtectedRoute` uses `LoadingSpinner` instead of a hand-rolled spinner div; redundant `mr-2` margins on icons inside gap-spaced menu items are removed.

### Patch Changes

- Updated dependencies [[`399ee35`](https://github.com/AshikNesin/groot/commit/399ee35d36a4bae5fcd3df68b481170d6f68da53)]:
  - @groot/ui@0.4.0

## 0.8.0

### Minor Changes

- [`c097350`](https://github.com/AshikNesin/groot/commit/c0973502ae2e731094876e05dcfc9b3db6b3ccfc) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Re-export `NavItem` from `Layout` so app consumers can import it from the same path they pass `navItems` to.

## 0.7.0

### Minor Changes

- [#105](https://github.com/AshikNesin/groot/pull/105) [`5efcd19`](https://github.com/AshikNesin/groot/commit/5efcd19c4d87de3afc47c32d8aae8fe2bd20e525) Thanks [@exe-dev-github-integration](https://github.com/apps/exe-dev-github-integration)! - Refine shell loading and hydration states: read the sidebar collapsed preference synchronously from `localStorage` (fixes the collapse flash on reload), give `<main>` a min-height for a stable footprint while content loads, and show a centered spinner during the initial auth check instead of a blank screen.

### Patch Changes

- [#107](https://github.com/AshikNesin/groot/pull/107) [`0051546`](https://github.com/AshikNesin/groot/commit/005154619ee39ca399a96bcea02ba0fbbcfd3e91) Thanks [@AshikNesin](https://github.com/AshikNesin)! - PageHeader actions now wrap on narrow viewports (fixes mobile overflow), and the vite client config dedupes its `@groot/*` alias list into a single const shared by the build and the test runner.

## 0.6.2

### Patch Changes

- Updated dependencies [[`90c30e0`](https://github.com/AshikNesin/groot/commit/90c30e02b09c3e355bd8a0aa0f431006dd55431b)]:
  - @groot/ui@0.3.0

## 0.6.1

### Patch Changes

- [#102](https://github.com/AshikNesin/groot/pull/102) [`011c6d5`](https://github.com/AshikNesin/groot/commit/011c6d5595ea9e4fff8911f56e497e497aecb380) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix pg-boss jobs list showing blank metadata; replace native confirm with a styled dialog

  The jobs dashboard table was missing data for pg-boss (Postgres) jobs: the
  "Started" column showed "—", "Created" showed "N/A", retry counts read 0, and
  expire/keep-until/dead-letter were empty — for _every_ job in the list (active
  jobs most visibly, since they always have a `started_on`). The stats counts at
  the top of the page were correct; only the per-row metadata was broken.

  Root cause: the raw-SQL dashboard queries (`getJobs`/`getJobsByState`/
  `getFailedJobs`) aliased columns to lower-case keys (`startedon`), but the
  shared `normalizeBossJob` reads pg-boss's camelCase shape (`startedOn`), so
  every camelCase field resolved to `undefined` → null/empty/0. Only
  `getJobById` (pg-boss's own accessor) was correct, which is why the detail
  page showed the right values. Fixed by aliasing the raw-SQL projection to
  camelCase (double-quoted so Postgres preserves case), matching the shape
  `normalizeBossJob` reads, so both paths agree.

  Also replaces every native `window.confirm()` — jobs page (bulk re-run,
  purge-by-state, delete job, cancel scheduled job) and storage page (delete
  files, delete folder) — with a new shared `ConfirmProvider`/`useConfirm`, a
  thin imperative convenience layer over a Radix `AlertDialog` primitive (a port
  of shadcn's `alert-dialog`). Both live under `@groot/ui/primitives` so callers
  know they are composed/Radix-backed, not direct shadcn re-exports. Using
  AlertDialog gives correct confirm semantics: the dialog can ONLY be closed by
  the action/cancel buttons or Escape (not by clicking the overlay), so a
  confirmation can never be dismissed accidentally. `Button` now exports a named
  `ButtonProps` so the alert-dialog action/cancel slots compose with the shared
  button variants (destructive, outline).

- Updated dependencies [[`011c6d5`](https://github.com/AshikNesin/groot/commit/011c6d5595ea9e4fff8911f56e497e497aecb380)]:
  - @groot/ui@0.2.2

## 0.6.0

### Minor Changes

- [#98](https://github.com/AshikNesin/groot/pull/98) [`b9906ec`](https://github.com/AshikNesin/groot/commit/b9906ec95ba2702d5f7f3176333e65be30a2ff8f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Make the shell Layout/SidebarNav/CommandPalette/Storage app-configurable

  The shell app shell (Layout, SidebarNav, CommandPalette) and the Storage page
  now accept optional props so child apps can brand the shell and extend the
  command palette / user menu without forking the components. All new props are
  optional with defaults that preserve the existing groot behavior, so the
  boilerplate's own app is unchanged.

  - `Layout`: `navItems`, `brand`, `userMenuItems`, `commandGroups` props. The
    sidebar offset (`lg:pl-56`/`lg:pl-16`) and the mobile top bar are now gated
    on `header === undefined` so a custom header no longer double-pads the page.
    The footer user dropdown is driven by `userMenuItems` (default = the prior
    Storage/Jobs/Settings + Log out entries) and supports `to`/`href`/`onSelect`
    entries with optional separators and destructive styling.
  - `SidebarNav`: `NavItem.icon` accepts a `LucideIcon` directly (in addition to
    the existing string keys). New `brand` prop (`{ label, icon?, to? }`) replaces
    the hardcoded "Groot" label/logo.
  - `CommandPalette`: `CommandPaletteDialog({ groups })` accepts custom
    `CommandGroupEntry[]` (default = the prior Navigation + Account groups).
  - `Storage`: optional `onView?: (file: StorageFile) => void` lets an app
    intercept "View" clicks for an in-app viewer (falls back to the existing
    open-in-new-tab behavior). The bulk-upload input was wired but never
    triggered by any button (dead code); the single Upload input is now
    `multiple` and routes 1-file vs multi-file uploads internally.

## 0.5.0

### Minor Changes

- [`b0a391b`](https://github.com/AshikNesin/groot/commit/b0a391b85274ab8cf2f6837b8dda4dadf6f716a1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Redesign settings UI with a dub-inspired card layout

  The Settings page, AppSettings, and PasskeyManager components have been
  reworked into a cleaner card-based layout inspired by Dub. The redundant
  desktop top toolbar in the Layout was also removed since the sidebar
  already provides navigation.

### Patch Changes

- [`b0a391b`](https://github.com/AshikNesin/groot/commit/b0a391b85274ab8cf2f6837b8dda4dadf6f716a1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Improve form field spacing and consistency

  The shared `form.tsx` primitives now apply more consistent spacing
  between fields. Updated the job dialogs (Add/Edit/Schedule) and
  AppSettings form to use the improved form components for uniform
  vertical rhythm across forms.

- Updated dependencies [[`b0a391b`](https://github.com/AshikNesin/groot/commit/b0a391b85274ab8cf2f6837b8dda4dadf6f716a1)]:
  - @groot/ui@0.2.1

## 0.4.0

### Minor Changes

- [#74](https://github.com/AshikNesin/groot/pull/74) [`1e85141`](https://github.com/AshikNesin/groot/commit/1e851410f1b5cdce9a6bcafd269da4f091c99245) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add `loginWithPasskey` to the shell auth store

  `useAuthStore` now exposes `loginWithPasskey(email?)`, which runs the WebAuthn
  ceremony via the existing `passkeyService.loginWithPasskey` and — on success —
  sets `isAuthenticated`/`user` and bumps `generation`, mirroring password login.

  Previously apps that wanted passkey login had to fork the store and track a
  separate `username` field. Now any app can `<PasskeyManager>` + call
  `loginWithPasskey` directly from `@groot/shell/store/auth`, keeping a single
  auth store. No change to existing fields or behavior.

- [#74](https://github.com/AshikNesin/groot/pull/74) [`225280b`](https://github.com/AshikNesin/groot/commit/225280b0899784e6fd92a363adb141dc7647bd24) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add `header` / `padded` / `mainClassName` / `className` slots to the shell `Layout`

  `<Layout/>` now accepts:

  - `header?: ReactNode` — render a custom header/nav (e.g. an app `<Navbar/>`)
    instead of the default shell header (logo + command palette + user menu).
  - `padded?: boolean` (default `true`) — toggle `<main>`'s default padding. Set
    `false` when pages own their own padding via `PageContainer`.
  - `mainClassName?` / `className?` — extra classes merged onto `<main>` / the
    outer wrapper.

  Fully backward compatible: `<Layout/>` with no props behaves exactly as before.
  Lets apps brand the shell without forking the whole layout component.

## 0.3.1

### Patch Changes

- [`5f9eddd`](https://github.com/AshikNesin/groot/commit/5f9eddd7bba05222c378578a7d0900dac53d52a2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - refactor: unify cross-package imports on @groot/\* aliases

  Standardizes import style so cross-directory imports always use the
  package alias (`@groot/core/*`, `@groot/shell/*`, `@groot/jobs/*`) while
  same-directory imports stay relative (`./`). Previously these were mixed —
  even within a single file (e.g. `../kv` next to `@groot/core/logger`) —
  making import style inconsistent across the codebase.

  ## @groot/core

  - Converted all cross-directory `../` imports to `@groot/core/*` aliases
    across `ai`, `auth`, `config`, `kv`, `middlewares`, `notification`,
    `passkey`, `settings`, `storage`, and `utils`.
  - Same-directory `./` imports left unchanged.
  - Prisma `../../generated/prisma/client` imports in `database/` kept
    relative (no alias maps to the generated output outside `src/`).

  ## @groot/shell

  - Converted cross-directory `../` imports to `@groot/shell/*` aliases
    across `components`, `hooks`, `lib`, `pages/storage`, `services`, and
    `store`.

  ## @groot/jobs

  - Converted cross-directory `../` imports to `@groot/jobs/client/*`
    aliases across the client `components/`.

## 0.3.0

### Minor Changes

- [`83b3a6f`](https://github.com/AshikNesin/groot/commit/83b3a6f1ce34a28299b00f18645faabf3e9569a8) Thanks [@AshikNesin](https://github.com/AshikNesin)! - refactor: unify API client, form handling, and server response flow

  A cross-cutting refactor of how the frontend talks to the API and how
  controllers shape responses, plus a shared Form primitive.

  ## @groot/core

  - Removed the `*System` namespace barrels (`AISystem`, `AuthSystem`,
    `ErrorSystem`, `KVSystem`, plus the passkey/settings/storage equivalents).
    Callers now use direct named imports instead of convenience namespaces.
  - Added `utils/controller.utils.ts` with `requireUser(req)` and
    `validatedBody<T>(req)` helpers, replacing repeated inline `req.user` /
    `req.body as` boilerplate across controllers.
  - Added `utils/api-response.utils.ts` to standardize controller response
    shapes.
  - Extracted shared Zod field shapes (`emailField`, `passwordField`) in
    `auth.validation.ts` so the client can reuse them for form validation
    (single source of truth).
  - Streamlined `error-handler`, `error-response`, `route-handler`, and
    `validation` middlewares.

  ## @groot/ui

  - Added a `Form` component (`form.tsx`) with `react-hook-form` integration and
    field helpers.

  ## @groot/shell

  - Reworked `lib/api.ts` (the `apiClient`) for simpler, more consistent request
    handling.
  - Added `useToastMutation` hook to standardize mutation + toast feedback.
  - Refactored `Login`, storage dialogs (`CreateFolderDialog`, `RenameDialog`),
    `PasskeyManager`, `AppSettings`, and the `useStorage` / `useAppSettings`
    hooks to build on the new Form component and apiClient.

  ## @groot/jobs

  - Refactored the client API layer (`api.ts`), `useJobs`, `useJobDetail`, and
    `JobsTable` to align with the new apiClient patterns.

### Patch Changes

- Updated dependencies [[`83b3a6f`](https://github.com/AshikNesin/groot/commit/83b3a6f1ce34a28299b00f18645faabf3e9569a8)]:
  - @groot/ui@0.2.0

## 0.2.0

### Minor Changes

- [#64](https://github.com/AshikNesin/groot/pull/64) [`ae54b49`](https://github.com/AshikNesin/groot/commit/ae54b4920f39b2dbd9432298855210cb4752cd57) Thanks [@AshikNesin](https://github.com/AshikNesin)! - refactor: reorganize codebase architecture

  - Flattened the `packages/` directory, merging `server`, `logger`, and `database` into `core`.
  - Renamed `client` to `shell`.
  - Moved boilerplate `auth`, `settings`, and `storage` modules out of `apps/web/src/client/pages` and into `@groot/shell`.
  - Replaced all legacy paths with their new equivalents in all codebase documentation, tests, and comments.

### Patch Changes

- Updated dependencies [[`ae54b49`](https://github.com/AshikNesin/groot/commit/ae54b4920f39b2dbd9432298855210cb4752cd57)]:
  - @groot/ui@0.1.0

## 0.1.0

### Minor Changes

- [#60](https://github.com/AshikNesin/groot/pull/60) [`0473401`](https://github.com/AshikNesin/groot/commit/0473401aacc5ccd4e67e8def92e98b30ecd72a9a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Extract all jobs code into a dedicated `@groot/jobs` package

  The entire jobs vertical — pg-boss backend infrastructure, HTTP admin API,
  job logger, the dashboard UI, client types, and API methods — now lives in a
  single `@groot/jobs` package with two flat entry points:

  - `@groot/jobs/server/*` — pg-boss queue/worker/queries, routes, job logger
  - `@groot/jobs/client/*` — dashboard UI, `jobsApi`, types

  Business-specific handlers (`todo.jobs.ts`) and bootstrap wiring stay in
  `apps/web/`. This consolidates jobs code that was previously spread across
  `@groot/core` (`core/job`, `shared/jobs`, `core/logger`), `@groot/shell`
  (`types/jobs`, apiClient methods), and `apps/web` (dashboard UI).

  **Breaking — migration required for downstream repos:**

  - `createJobLogger` / `JobLogStream` / `createJobLogStream` moved from
    `@groot/core/core/logger` → `@groot/jobs/server/logger`. The
    `@groot/core/core/logger` re-exports are removed.
  - The 17 job methods were removed from `apiClient` (`@groot/shell/lib/api`).
    Use `jobsApi` from `@groot/jobs/client` instead.
  - `JobName` changed from an enum (with hardcoded `TODO_*` values) to
    `type JobName = string`. App-specific job names live with their handlers.
  - Server-side imports of job infra must move from
    `@groot/core/core/job/*` and `@groot/core/shared/jobs/*` to
    `@groot/jobs/server/*` (use explicit subpaths like `/worker`, `/logger`,
    `/routes` for the server bundle).
  - The jobs dashboard UI moved from `apps/web/src/client/pages/jobs/` to
    `@groot/jobs/client`. Import pages via `@groot/jobs/client`.

  The `database → logger → job-stream → database` module cycle is resolved as
  a side effect (job-stream left `@groot/core/core/logger`). `pg-boss` is no
  longer a dependency of `@groot/core` (it now lives in `@groot/jobs`).
