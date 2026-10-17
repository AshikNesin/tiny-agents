> **Superseded (2026-09-22):** the "own the implementations" half of this DLS
> was reversed by [ADR 0002](../adr/0002-adopt-kumo-directly.md) — groot is
> adopting `@cloudflare/kumo` directly. The _conventions and enforcement_
> sections below remain in force for app-authored code; component
> implementations described here are being replaced by Kumo. See
> [ADR 0001](../adr/0001-own-dls-on-shadcn-stack.md) for the original decision.

# The Groot DLS (Design Language System)

This document is the source of truth for how groot UI looks and behaves. The
stack stays what it is — **Tailwind v4 (CSS-first) + shadcn-style primitives
(Radix) + cva** in [`@groot/ui`](../../packages/ui) — with rules adapted from
[Cloudflare Kumo](https://kumo-ui.com)'s design skill (MIT). We build our own
system; Kumo is the reference, not a dependency.

Related: [client.md](./client.md) maps needs to primitives; the rules below
are _enforced_ by `pnpm check:tokens` (see [enforcement](#enforcement)).

## Principles

1. **The type scale is closed.** The sanctioned text treatments are defined in
   `@groot/ui/typography` and nowhere else. Pages never pick `text-*` sizes ad
   hoc; use `Text` (or the exported classes) instead.
2. **One definition per idiom.** `metaLabelClass` is the only uppercase
   `tracking-wider` label; `tableColumnHeaderClass` equals it by design;
   `monoClass` is the only inline-mono treatment.
3. **Semantic tokens only** (`text-foreground`, `bg-muted`, …) — raw palette
   classes are confined to `packages/shell/src/index.css`.
4. **Primitives own motion.** Hover color changes are instant (no
   `transition-colors`); transforms may transition. Entrance/exit
   choreography lives in `@groot/ui` primitives, never in pages.
5. **Semantic markup, locked styling.** `Text` locks size/weight/tone; whether
   it renders as an `h2` or a `span` is the caller's structural decision.

## The type scale

| Class / component                     | Treatment                                                                | Use for                                    |
| ------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| `Text variant="title"` / `titleClass` | `font-heading text-base leading-snug font-medium`                        | Section titles, card titles, dialog titles |
| `Text variant="body"`                 | `text-sm` (14px)                                                         | Body, labels, buttons, data — the default  |
| `Text variant="meta"`                 | `text-xs text-muted-foreground`                                          | Timestamps, counts, helper copy            |
| `Text variant="code"` / `monoClass`   | `font-mono text-[0.9em]`                                                 | Inline ids, cron expressions, tokens       |
| `Text variant="stat"` / `statClass`   | `text-xl font-semibold tabular-nums`                                     | Standalone metric values (not headings)    |
| `PageHeader` h1 / `h1Class`           | `text-xl font-semibold sm:text-2xl`                                      | Routed-page title — the only `<h1>`        |
| `displayClass`                        | `text-3xl font-semibold leading-tight`                                   | Marketing/display moments (auth panels)    |
| `metaLabelClass`                      | `text-[11px] font-medium uppercase tracking-wider text-muted-foreground` | Column headers, dl labels, stat captions   |

Content text is 14px (`text-sm`) — 16px+ is reserved for titles and display.
`titleClass` matches `CardTitle`/`DialogTitle` by design.

## Rules (adapted from Kumo, re-derived for Radix)

| #   | Rule                                                                                   | Enforced                     |
| --- | -------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Content text is 14px; 16px+ only for titles/display                                    | partial (type-scale classes) |
| 2   | Sentence case for headings and titles                                                  | no                           |
| 3   | Never modify letter tracking (`tracking-*`)                                            | yes                          |
| 3a  | …except `metaLabelClass`, the single sanctioned uppercase `tracking-wider` label       | via allow-list               |
| 4   | Never `font-bold`; `font-semibold` is the max weight                                   | yes                          |
| 5   | Related text groups closer together than their parent group                            | no                           |
| 6   | Optical spacing around text (vertical < horizontal)                                    | no                           |
| 7   | No color transitions on hover — instant color change                                   | yes (outside `@groot/ui`)    |
| 8   | Borders and shadows don't combine; prefer `ring-1 ring-foreground/10`                  | no                           |
| 9   | Concentric border radii (outer = inner + padding)                                      | no                           |
| 10  | Icons optically sized to and aligned with the first line of text (`size-4`/`size-3.5`) | icon-sizing rule             |
| 11  | Inline mono at `text-[0.9em]` (`monoClass`)                                            | yes                          |
| 12  | Sticky elements separated from content with `border`, not shadow                       | no                           |
| 13  | Collapsing content keeps its size during animation                                     | no                           |
| 14  | Never stack layer cards on top of one another                                          | no                           |
| 15  | Never conditionally render dialogs — control with `open` prop                          | no                           |

Rules marked _no_ are conventions enforced by review and the design skill
(`.agents/skills/groot-dls/SKILL.md`), not mechanical patterns.

## Composition components

The DLS ships the recurring higher-order patterns as components (evidence:
each was hand-rolled in ≥3 places across groot/child projects before
centralization):

| Component                           | Idiom                                                                                           | Predecessors                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `DataField` / `DataFields`          | Read-only label/value grid (`dt`/`dd`) — display counterpart to form-`Field` (`@groot/ui/form`) | JobOverview local `Field`, JobDetail hand-rolled ×2, JobDataView xs variant |
| `StatTile`                          | Metric tile (meta label + icon + `statClass` value); button variant for filter-stats            | JobsStats inline tile                                                       |
| `listRowClass` / `listRowGridClass` | Interactive list-row treatments as class constants (rows stay semantic `<li>`/`<button>`)       | 5 hand-rolled rows across jobs/shell/web; 86 files in child projects        |

**Pull, don't push:** components are added when a pattern recurs, not
preemptively. Charts, date pickers, comboboxes, tag inputs, meters, and
toolbars are deliberately absent — no in-repo or child-project demand; build
them against our tokens when a feature needs one (see rejected-alternatives
for the Kumo-dependency reasoning).

## Enforcement

`scripts/check-design-tokens.ts` greps all client dirs for drift and runs from
the pre-commit hook and CI (`.github/workflows/check-design-tts.yml`). It now
has 9 rules: the original 5 plus `tracking-modified`, `font-bold`,
`transition-colors-hover`, and `inline-mono-full-step`. Exemptions are
intentional and documented in the rule's `allow` list:

- `typography.tsx` — defines the scale (tracking on metaLabel is sanctioned).
- `packages/ui/src/` (prefix) — primitives own motion language.
- `command.tsx`/`CommandPalette.tsx` — dense kbd hint, mono at reduced size.

## Migration notes

- `tracking-tight` removed from 8 headings (PageHeader, Layout brand,
  SidebarNav ×2, Login ×3, CommandPalette trigger already untracked).
- Local meta-label copies in jobs (JobsStats, JobOverview) now use
  `tableColumnHeaderClass`.
- `font-mono text-sm` inline mono → `text-[0.9em]` in 3 files.
- Login h1 now uses `h1Class` (was `text-2xl` standalone); the marketing h2
  uses `displayClass`.
- `transition-colors`/`transition-all` removed from 17 page/shell sites;
  primitives keep theirs (sanctioned motion layer).

## Rejected alternatives

- **Adopting `@cloudflare/kumo` as a dependency** — Base UI swap, Phosphor
  icons, token remap, z-index/portal caveats, and Cloudflare-flavored breadth
  for components we'd rarely use. Our stack already matches Kumo's philosophy
  (semantic oklch tokens, 14px content); we keep Radix and our token names.
- **Kumo token names** (`--color-kumo-*`) — churning every file and rewriting
  the gate for zero user-visible gain.
- **shadcn registry borrowing** — components drift from local conventions
  (Base UI in new-style ones); copying classes by hand keeps the kit ours.

> Reference: Kumo design skill — https://kumo-ui.com/skill (MIT).
