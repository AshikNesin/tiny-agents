# Client

A Vite + React 19 SPA that consumes the Hono API through a small `fetch`
client and React Query.

## Routing & layout

Routes are defined in `apps/web/src/client/App.tsx`:

| Route                  | Component            | Auth      |
| ---------------------- | -------------------- | --------- |
| `/login`               | `Login`              | Public    |
| `/` → `/todos` (index) | `Todos`              | Protected |
| `/storage`             | `Storage`            | Protected |
| `/jobs`, `/jobs/:id`   | `Jobs` / `JobDetail` | Protected |
| `/settings`            | `Settings`           | Protected |

`ProtectedRoute` checks `useAuthStore` and redirects unauthenticated users to
`/login`. `Layout` renders the sidebar, the account menu, the ⌘K palette and an
`<Outlet>` for nested routes.

## Navigation (`ShellConfig`)

`<ShellProvider config={…}>` (`@groot/shell/lib/shell-config`) describes the
shell once:

| Field   | Drives                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `brand` | `{ label, icon?, to? }`: the sidebar, mobile bar and login logo; defaults to Groot, `LayoutDashboard`, `/`              |
| `nav`   | `{ label, icon?, to, primary? }[]`: `primary` entries are sidebar rows, the rest account-menu rows; all are ⌘K commands |
| `login` | `{ tagline?, description?, features? }`: the login brand panel                                                          |

The shell always adds the theme submenu and **Log out** (one action: end the
session, toast, go to `/login`) to the account menu, and Theme and Account
groups to ⌘K. `Layout` takes `commandGroups` for app-specific ⌘K groups
(listed between Navigation and Theme), `header` to replace the sidebar and
mobile bar with your own, and `padded`, `mainClassName`, `className`.

`App.tsx` keeps a `PAGES` list of `NavDestination & { element }`: it is both
`ShellConfig.nav` and the routes, so a page with a place in the navigation is
declared once. Routes without a nav entry (`jobs/:queueName/:jobId`) are
written out as usual.

## Transport and session

`apiClient` (`@groot/shell/lib/api`) is pure transport on `fetch`: it prefixes
`/api/v1`, sends the cookie (`credentials: "include"`), JSON-encodes bodies
(`FormData` goes as multipart), unwraps the `{ success, data }` envelope and
throws an `ApiError` (`status`, `code`, `message`, `details`, `url`) for any
non-2xx response. It knows nothing about sessions: `apiClient.onUnauthorized(handler)`
reports each 401 with its `path` and `sentAt` time.

The session is `useAuthStore` (`@groot/shell/store/auth`, Zustand). The server
keeps the JWT in an HttpOnly `token` cookie, so the store holds only the user:

| Member                                          | Does                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `user`, `isAuthenticated`, `hasCheckedAuth`     | The signed-in `SessionUser` (`{ id, email, name }`); whether `checkAuth()` settled |
| `login(email, password)` / `loginWithPasskey()` | Sign in (`/auth/login`, or the WebAuthn ceremony); reject with the original error  |
| `logout()`                                      | `POST /auth/logout`, then ends the local session; never rejects                    |
| `checkAuth()`                                   | Resolves the session from the cookie on app load (`GET /auth/me`)                  |
| `generation`, `clearAuth()`                     | Bumped on every sign-in/out; end the local session without a server call           |
| `loginErrorDescription(error, fallback)`        | The sign-in failure wording (401 → "Invalid email or password.")                   |

The store installs the 401 hook: a 401 for a request sent during the current
session clears it, so `ProtectedRoute` redirects to `/login`. A 401 for a
request sent before the last sign-in or sign-out is ignored.

## Data fetching

- React Query is mounted globally.
- Feature hooks (e.g. `useTodos`) wrap list + CRUD mutations and invalidate
  caches after each mutation.
- Errors surface via `useToast` (Sonner) for immediate UI feedback.

## UI system

- **Tailwind CSS** + `tailwindcss-animate`, configured in `packages/shell`.
- **shadcn-style primitives** (`Button`, `Card`, `Dialog`, `Input`, …) live in
  the [`@groot/ui`](../../packages/ui) package.
- **Design rules** (type scale, motion, idioms) live in [`dls.md`](./dls.md) —
  the DLS, Kumo-referenced, enforced by `pnpm check:tokens`.
- Pages compose these with React Query hooks to render server data.

### Rules

The primitives below are the _only_ way to render these things. Hand-rolling a
replacement is what makes the UI drift, so `pnpm check:tokens` fails the build
on the common cases (see [enforcement](#enforcement)).

| Need                       | Use                                                                                                                                                                      | Don't                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bordered surface         | `Card` (+ `CardHeader`/`CardContent`/`CardFooter`)                                                                                                                       | `rounded-xl border bg-card` on a `div`                                                                                                               |
| Page title / chrome        | `PageLayout`                                                                                                                                                             | a hand-written `<h1>` or `max-w-* mx-auto`                                                                                                           |
| In-page section heading    | `Section` (`title`, `meta`, `description`, `actions`)                                                                                                                    | a `text-sm font-medium` span + a count span                                                                                                          |
| Empty list / nothing found | `EmptyState`                                                                                                                                                             | an ad-hoc icon + heading + copy stack                                                                                                                |
| Failed load                | `ErrorState` (+ a retry `action`)                                                                                                                                        | ditto, tinted red                                                                                                                                    |
| Loading a whole surface    | `SkeletonTable` / `SkeletonList` / `SkeletonCard` from `@groot/ui` (compose with `Skeleton` for one-off bits); `LoadingState` only for unknown shapes or app-level gates | a per-page custom skeleton component, a bare "Loading…" string, an inline spinner div, or a big centered spinner inside a list whose layout is known |
| Tabular data               | `Table`; `tableColumnHeaderClass` for grid-based tables                                                                                                                  | a raw `<table>`/`<thead>`                                                                                                                            |
| Status / state pill        | `StatusBadge` (token-driven); `Badge` for neutral tags                                                                                                                   | a local status→color map                                                                                                                             |
| Destructive confirmation   | `useConfirm({ destructive: true })`                                                                                                                                      | a bespoke `Dialog` (dismissible by overlay)                                                                                                          |
| Scrolling dialog content   | `DialogBody` between `DialogHeader` and `DialogFooter` (header and footer stay pinned)                                                                                   | a hand-rolled `overflow-y-auto` wrapper                                                                                                              |
| Icon sizing                | `size-4` / `size-3.5`                                                                                                                                                    | `h-4 w-4`                                                                                                                                            |
| Icon spacing in a button   | nothing — `Button` already sets `gap`                                                                                                                                    | `mr-2` on the icon                                                                                                                                   |
| Any text treatment         | `Text` / `metaLabelClass` / `monoClass` from `@groot/ui`                                                                                                                 | ad-hoc `text-*` sizes, `tracking-*`, `font-bold`, inline `font-mono` at full size                                                                    |
| Hover state                | instant color change                                                                                                                                                     | `transition-colors` / `transition-all` on hover                                                                                                      |
| Key-value data (read-only) | `DataField` + `DataFields` from `@groot/ui`                                                                                                                              | hand-rolled `<dl>`/`<dt>`/`<dd>` with ad-hoc label classes                                                                                           |
| A standalone metric/stat   | `StatTile` from `@groot/ui`                                                                                                                                              | icon + label + `text-xl font-semibold tabular-nums` stacks written per page                                                                          |
| Interactive list rows      | `listRowClass` / `listRowGridClass` from `@groot/ui` (class constants)                                                                                                   | per-page `hover:bg-muted/40 px-4 py-3 …` strings                                                                                                     |

Colors come only from semantic token classes (`bg-primary`, `text-foreground`,
`text-destructive`, `text-muted-foreground`, `border-border`, …). Raw palette
classes (`gray-*`, `red-*`, …) are allowed _only_ in
`packages/shell/src/index.css`, which defines the tokens.

### Enforcement

`scripts/check-design-tokens.ts` greps every client dir (`packages/*/src` and
`apps/*/src/client`, so a new package or app is covered without an edit) for
both token and structural drift. It runs:

- on every commit via the `vp staged` pre-commit hook (`vite.config.ts`), and
- in CI as a step of `.github/workflows/test.yml`, which catches
  `--no-verify` commits.

## Layering (import rules)

| Layer              | Import path            | Purpose           | Synced? |
| ------------------ | ---------------------- | ----------------- | ------- |
| `@groot/ui`        | `@groot/ui/button`     | Design primitives | Yes     |
| `@groot/shell`     | `@groot/shell/lib/api` | Client infra      | Yes     |
| `apps/web/…/pages` | `./pages/todo/Todos`   | Business features | No      |

`ui/` can't import `shell`/`pages`; `shell/` can't import `pages/`.

## Extending the client

1. Add the page to `PAGES` in `App.tsx` (route, sidebar or account-menu row
   and ⌘K entry in one line), or a plain `<Route>` if it has no nav entry.
2. Create a React Query hook in the feature's `hooks/` that calls `/api/v1/*`.
3. Compose the UI in `pages/`, using the shared layout + toasts.
4. For global state, prefer Zustand slices or React Query caches over ad-hoc
   contexts.
