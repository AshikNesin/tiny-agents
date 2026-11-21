# Git hooks & secret detection

Each hook's script is the list of what it runs; this page says why and what to
do when one stops you. CI also scans every PR and push for secrets, so a commit
made without gitleaks still gets a scan.

## What Gets Checked

A commit runs `.vite-hooks/pre-commit`, and the `staged` commands it ends with
are in `vite.config.ts`. It stops in a worktree with no `node_modules`, and it
skips the gitleaks scan with a notice when gitleaks is not on `PATH`. Keep
`--staged` on `gitleaks protect`: without it gitleaks reads `git diff` (working
tree against the index) and skips exactly the content the commit will contain.

A branch push runs `scripts/pre-push.mjs`, whose `prePushPlan` decides which
changed files it formats and lints and when it runs the incremental typecheck.
It reads the working tree, not the commits you push. The typecheck keeps tsc's
state in `node_modules/.cache/tsc/`, so the first push after a branch switch or
in a fresh worktree is slower than the next. CI runs every check on every file.

CI's secret scan is `scripts/secret-scan.sh`; `.github/workflows/test.yml`
passes it the range each event adds.

## Setup

```bash
# gitleaks is a separate binary; without it the hook skips the local scan
brew install gitleaks  # macOS
# or: go install github.com/gitleaks/gitleaks/v8@latest  # Other platforms

pnpm install           # runs `prepare` (vp config), which installs the hooks
```

`core.hooksPath` is the relative `.vite-hooks/_`, and every file `vp config`
writes there is tracked, so each git worktree runs its own hooks from its first
checkout and they stop every commit and push until you run `pnpm install` in
it. If a Vite+ upgrade changes those files, the upgrade commits them. `prepare`
(`scripts/relative-hooks-path.mjs`) turns an absolute `core.hooksPath` back
into the relative one; rerun `pnpm prepare` if the hooks stop running.

## Running Manually

```bash
sh -e .vite-hooks/pre-commit                     # the whole hook
gitleaks protect --staged --config .gitleaks.toml  # gitleaks on the staged changes
pnpm exec vp staged                              # only the staged checks
```

## Gitleaks Configuration

`.gitleaks.toml` keeps gitleaks' built-in rules, adds rules for quoted secret
literals, and holds the allowlist. For a false positive, add a path regex to
`paths` under `[allowlist]`, or end the line with a `gitleaks:allow` comment.

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

`.gitignore` keeps env files (all but `.env.example`), `.dev.vars`, keys,
certificates and credential files out of the repo.
