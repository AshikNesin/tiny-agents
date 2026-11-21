# Git hooks & secret detection

Every commit runs secret detection (gitleaks) and staged lint/format (Vite+),
and every branch push checks the files it changes, typechecking when TypeScript, a tsconfig or a `package.json` changed. CI also scans every PR and push for
secrets, so a commit made without gitleaks still gets a scan.

## What Gets Checked

`.vite-hooks/pre-commit` runs, in order (`sh -e`, so the first failure blocks
the commit):

| Step             | Command                                                                | Purpose                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Install**      | `command -v vp`                                                        | Stops the commit with a message naming `pnpm install` when the worktree has no `node_modules`. The pre-push hook starts with the same check                                             |
| **Gitleaks**     | `gitleaks protect --staged --verbose --redact --config .gitleaks.toml` | Scans the staged changes for hardcoded secrets; findings are redacted. Without gitleaks on `PATH`, the hook prints `gitleaks not installed, secret scan runs in CI` and skips this step |
| **Vite+ staged** | `vp staged`                                                            | Runs the `staged` commands from `vite.config.ts` on the staged files                                                                                                                    |

The `staged` block in `vite.config.ts`:

```typescript
staged: {
  "*": "vp check --fix",                     // lint + format (Oxlint + Oxfmt)
  "*.{ts,tsx,css}": "pnpm check:tokens",     // design-token rules
},
```

Keep `--staged`: without it `gitleaks protect` reads `git diff` (working tree
against the index) and skips exactly the content the commit will contain.

`.vite-hooks/pre-push` hands git's ref lines to `scripts/pre-push.mjs`, which
skips tag-only pushes and branch deletions. For a push that updates a branch it
takes the files the pushed commits change (against the remote's tip, or the
merge base with `origin/main` for a new branch) and runs, at once:

| Check                   | Command                                                 | Runs when                                                                               |
| ----------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Format                  | `vp fmt --check <changed files>`                        | a changed file is one Oxfmt formats                                                     |
| Lint                    | `vp lint <changed files>`                               | a changed file is JavaScript or TypeScript                                              |
| Typecheck (incremental) | `pnpm typecheck` (`pnpm verify:static --job typecheck`) | a `.ts`/`.tsx` file, a tsconfig or a `package.json` changed, was deleted or was renamed |

It reads the working tree, not the commits you push. The typecheck runs the
server, client, e2e and kit programs in parallel, each keeping its state in
`node_modules/.cache/tsc/`, so a push after a small edit rechecks only what
changed: about 3.5 s for the whole hook on a warm cache. The first push after a
large change (a branch switch, a fresh worktree) rebuilds that state, about
11 s. CI runs every check on every file.

The Tests workflow runs a pinned gitleaks through `scripts/secret-scan.sh` on
the commits each event adds: `origin/<base>..HEAD` on a PR and
`<before>..HEAD` on a push. When `<before>` is all zeros (a new branch) or is
not in the checkout (a force-push), the script scans `origin/main..HEAD`. When
that range is empty, it scans `HEAD` alone.

## Setup

```bash
# gitleaks is a separate binary; without it the hook skips the local scan
brew install gitleaks  # macOS
# or: go install github.com/gitleaks/gitleaks/v8@latest  # Other platforms

pnpm install           # runs `prepare` (vp config), which installs the hooks
```

`core.hooksPath` is the relative `.vite-hooks/_`, so each git worktree runs its
own hook scripts. Every file `vp config` writes there (`h`, one stub per hook
and `.gitignore`) is tracked, byte for byte, so a new worktree has them before
any install. Its hooks then stop every commit and push until you run
`pnpm install` in it. If a Vite+ upgrade changes what `vp config` writes, the
install shows those files as modified, and the upgrade commits them. Checking
out a commit from before they were tracked deletes the whole directory, so git
runs no hooks at that commit until `pnpm install`. Checking out a newer commit
puts the files back. `prepare` also changes an absolute `core.hooksPath` that ends in
`.vite-hooks/_` to the relative path. Rerun `pnpm prepare` if the hooks stop
running.

## Running Manually

```bash
sh -e .vite-hooks/pre-commit                     # the whole hook
gitleaks protect --staged --config .gitleaks.toml  # gitleaks on the staged changes
pnpm exec vp staged                              # only the staged checks
```

## Gitleaks Configuration (`.gitleaks.toml`)

- `[extend] useDefault = true` keeps gitleaks' built-in rules (cloud keys,
  tokens, private keys, connection strings).
- Two custom rules catch generic assignments: `generic-password-assignment`
  (`password`/`passwd`/`pwd` followed by `=` or `:` and 4+ characters) and
  `generic-secret-assignment` (`secret`, `api_key`, `token`, ... with 8+
  characters).
- The global allowlist skips `.env.example`, everything under `docs/`, and
  `*.test.*` / `*.spec.*` files.

For a false positive elsewhere, add a path regex to `paths` under
`[allowlist]`, or end the line with a `gitleaks:allow` comment.

## Skipping Hooks

Only when necessary, for example a known test secret outside the allowlist:

```bash
git commit --no-verify -m "message"   # skip all hooks for one commit
VITE_GIT_HOOKS=0 git commit -m "..."  # same, via the hook wrapper
```

The release workflow sets `VITE_GIT_HOOKS=0` for its "chore: version packages"
commit, which changes only package versions and changelogs. If a secret was committed, rotate it;
removing it from a later commit does not remove it from history.

## Sensitive Files

`.gitignore` keeps these out of the repo:

```
.env                     # Environment files
.env.*                   # All env variants (except the committed .env.example)
.dev.vars                # wrangler dev secrets (copy from .dev.vars.example)
*.pem                    # Certificates
*.key                    # Private keys
*.crt                    # Certificates
secrets/                 # Secrets directory
credentials.json         # Credential files
service-account.json     # Service account keys
```
