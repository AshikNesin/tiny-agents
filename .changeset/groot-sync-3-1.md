---
"@groot/ui": minor
"@groot/shell": minor
"@groot/core": patch
"tiny-agents": patch
---

Synced groot 3.1 (b1661dd).

- **Command palette.** The ⌘K palette is now groot's Fluid command menu (`@groot/ui/command-menu`), with tabs per group and keyboard shortcuts. tiny-agents still passes `commandBuiltIns={false}`, so its own Navigation, Theme and Account groups appear once.
- **Session guard and client address.** The fixes upstreamed from tiny-agents now come back from groot, so the next sync has nothing to merge in these files. The shell declares the `SESSION_INVALID` literal itself instead of importing a type from core. On Workers, `clientIp()` falls back to `cf-connecting-ip`.
- **Kept local.** tiny-agents' versions and changelogs, its CI gates, its first-run setup page (`min-dvh`), its login page and its client docs stay as they were.
