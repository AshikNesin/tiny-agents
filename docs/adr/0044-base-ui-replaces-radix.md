# ADR 0044: Base UI replaces Radix as the one primitive layer

- Status: **accepted** (amends 0001 and 0003)
- Date: 2026-11-26

## Context

The UI ran on three primitive layers: Radix (through `radix-ui`) in
`@groot/ui`, Base UI in the vendored Fluid components, and `@shadcn/react`
helpers. Pages also imported Radix directly for the switch, collapsible,
toggle group and popover. Two layers meant two composition models (`asChild`
and `render`), two sets of state attributes (`data-state` and `data-open`,
`data-checked`), and two focus and dismissal behaviors in one app. ui-sdk.dev
was evaluated and declined in issue 576: it would add a layer, not remove one.

## Decision

- **Base UI (`@base-ui/react`) is the one primitive layer.** Every primitive in
  `@groot/ui` and in `packages/ui/vendor/fluid` is built on it. `radix-ui` is
  no longer a dependency.
- **Composition uses `render`, not `asChild`.** `Button`, `Badge`,
  `BreadcrumbLink`, `Label` and every trigger take a `render` element or
  function. `scripts/codemods/as-child-to-render.ts` rewrites old call sites.
- **Primitives are imported only in `packages/ui`** (lint R18). Pages import
  `@groot/ui`. The switch, collapsible, toggle group, search select and item
  moved there from `apps/web`. `@shadcn/react` and `cmdk` stay allowed where
  they are used.
- **Styles key off Base UI attributes**: `data-open`, `data-closed`,
  `data-checked`, `data-active` (tabs), `data-popup-open` (triggers),
  `--transform-origin`, `--anchor-width` and `--available-height`.

## Consequences

- `@groot/ui` takes a major version: `asChild` is gone, and a menu `onSelect`
  is mapped onto Base UI's `onClick`.
- A single toggle group keeps radio semantics (`radiogroup`, `radio`,
  `aria-checked`) so keyboard and screen reader behavior is unchanged.
- Popups open asynchronously, so tests find them with `findBy*`.
- jsdom has no `Element.getAnimations`; `tests/client/setup.ts` stubs it.
