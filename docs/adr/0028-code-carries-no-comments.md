# 0028 — Code carries no comments; decisions live in ADRs

- Status: accepted
- Date: 2026-11-20

## Context

The codebase held about 14,200 comments in its own TypeScript, JavaScript,
Kotlin and CSS (vendored and generated files aside). Read one by one, they
fall into four kinds:

- **Tautology**: repeats what the code already says.
- **Excuse**: explains away a hack ("for now", "workaround", "until X
  lands"). An agent reads it as permission, and copies the hack elsewhere.
- **Stale**: names code, a phase or a behaviour that is gone.
- **Decision record**: a real, non-obvious decision about the code.

The first three cost tokens on every read and teach agents the wrong thing.
The fourth is worth keeping, but next to one line of code it is easy to miss,
easy to leave behind when the code moves, and impossible to supersede.

## Decision

- Code carries no comments. Say it in a name, a type, a test or a lint rule.
- A decision record moves into an ADR in this folder. An excuse is deleted
  and becomes a GitHub issue to fix the hack. A tautology or a stale comment
  is deleted.
- Lint rule R16 (`repo/no-comments` in `scripts/lint/repo-plugin.mjs`) bans
  comments in TypeScript and JavaScript, and `pnpm check:comments`
  (`scripts/check-comments.ts`, a gate in `scripts/gates.mjs`) bans them in
  Kotlin and CSS too.
- The sweep started from a ratchet that let each file keep its old comments
  until they were deleted. Once every count reached zero, on 2026-11-28, the
  ratchet, its baseline file and the sweep skill were removed: there is no
  allowance left to shrink.
- Kept as they are: tool directives (`eslint-disable`, `oxlint-disable`,
  `@ts-expect-error`, `/* @__PURE__ */`, `@Suppress`-style markers), license
  headers, generated files, and the paths in `OUT_OF_SCOPE` in
  `scripts/lint/comments.mjs`.

## Consequences

- Each sweep was a mechanical diff plus a short list of issues and ADRs; the
  zero-tolerance rule keeps comments from coming back.
- A reader who wants the why looks in `docs/adr/`, the issue, or `git blame`,
  not beside the line.
- Files synced from groot (`packages/core`, `jobs`, `shell`, `ui`) and the
  Android app may get comments back in a sync merge; the gate catches them in
  the sync PR.
- JSDoc on an exported symbol no longer shows in editor hovers. A name or a
  type that says the same thing is the fix.

## Alternatives considered

- **Ban only new comments, keep the old.** The old ones keep teaching the
  same habits, so the sweep runs too.
- **Allow `why:` comments.** Every comment claims to be a why; the decision
  belongs where it can be read, linked and superseded.
