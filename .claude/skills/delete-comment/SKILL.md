---
name: delete-comment
description: Sweep code comments out of a path in tiny-agents. Categorise each as tautology, excuse, stale or decision record; delete them, file issues for excuses, move decisions into ADRs, and shrink the comment ratchet. Use for /delete-comment, or when R16 or `pnpm check:comments` flags comments.
---

# /delete-comment

Code in this repo carries no comments (ADR 0028, lint rule R16). Old ones are
allowed by the ratchet in `scripts/lint/comment-baseline.json` until someone
sweeps them. This skill is that sweep.

Argument: a path or glob (`/delete-comment packages/agent`). With none, pick
the files with the most allowed comments in the baseline.

## 1. List the comments

`pnpm check:comments` counts what is left. The files in scope, and the
comments that are kept, are defined in `scripts/lint/comments.mjs`:
`OUT_OF_SCOPE` (vendored, generated, synced tooling) and `isKeptComment`
(tool directives such as `eslint-disable`, `oxlint-disable`,
`@ts-expect-error`, `/* @__PURE__ */`, license headers). Leave those alone.

Read every comment in the files you sweep, with the code around it. Treat a
run of `//` lines as one comment.

## 2. Categorise each one

| Kind            | Test                                                                                                                                                                               | Action                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Tautology       | Says what the next lines already say, or a JSDoc that restates the name and types.                                                                                                 | Delete.                                    |
| Stale           | Names a function, file, flag, phase, issue or behaviour that no longer exists or no longer matches the code. Check with a search, do not guess.                                    | Delete.                                    |
| Excuse          | Explains away a shortcut: "for now", "hack", "workaround", "TODO", "temporary", "until X", "not ideal", a cast or a swallowed error justified in prose.                            | Delete, and list it for an issue (step 4). |
| Decision record | A real, non-obvious choice a reader could not get back from the code, a test or an existing ADR: why this and not the obvious alternative, an outside constraint, a bug it avoids. | Delete, and move it into an ADR (step 5).  |

When unsure between tautology and decision record, ask: would a careful
engineer, reading only the code and its tests, make the wrong change without
this? If not, it is a tautology. If the code can say it (a better name, a
named constant, a type, a test), make that change instead and delete the
comment. Keep such changes small and behaviour-neutral.

## 3. Delete

- Remove the comment and any blank line it leaves doubled. Do not touch the
  code otherwise, except the small renames from step 2.
- A comment that holds a lint directive and prose (`// eslint-disable-line
  foo -- because`) keeps the directive; drop the prose after `--` only if it
  is a tautology.
- Under `mobile/android/`, bump `VERSION_CODE` and `VERSION_NAME` in
  `mobile/android/version.properties` and add a `mobile/CHANGELOG.md` entry
  (AGENTS.md).

## 4. Excuses become issues

One GitHub issue per hack, not per comment: group comments that excuse the
same shortcut. Search open issues first. Title it as the fix ("Replace the
polling loop in X with an event"); in the body quote the deleted comment, link
the file and line at the base commit, and say what a proper fix looks like.
Label it `tech-debt` if the label exists.

## 5. Decisions become ADRs

- Add one ADR per sweep, `docs/adr/NNNN-decisions-from-comments-<area>.md`,
  with the next free number, Status `accepted`, and one short section per
  decision: the file and symbol it governs, the decision, and why. Group
  related comments into one section. If a decision belongs to an existing
  ADR's subject, say so and link it; never edit an accepted ADR.
- Add the row to the index in `docs/adr/README.md`.

## 6. Shrink the ratchet and check

```bash
pnpm comments:ratchet      # lowers each file's allowance to its new count
pnpm check:comments        # must pass
pnpm check                 # lint and format, R16 included
pnpm exec tsc --noEmit && pnpm typecheck:client
pnpm check:doc-refs        # the new ADR names real paths
```

`pnpm comments:ratchet` never raises a count. If a file shows more comments
than its allowance, you added one: remove it.

## 7. Report

State the comments and lines removed, the count by kind, the issues filed and
the ADR written. `git diff --shortstat` gives the lines shed.
