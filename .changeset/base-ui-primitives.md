---
"@groot/ui": major
"tiny-agents": patch
---

`@groot/ui` is built on Base UI instead of Radix. Components that took `asChild` now take `render` (an element or a function); run `scripts/codemods/as-child-to-render.ts` to rewrite call sites. Menus, dialogs, select, tabs, tooltips and checkboxes style off Base UI's `data-open`, `data-checked` and `data-active` attributes. New exports: `collapsible`, `item`, `search-select`, `switch`, `toggle-group`, `fluid/ask-user-questions` and `fluid/thinking-indicator`.
