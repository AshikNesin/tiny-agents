---
"@tiny-agents/sandbox": patch
---

Navigation guard fixes (S7 follow-up).

- **No hang on a busy tab:** the guard asks the browser process for a tab's id (`Target.getTargetInfo`) instead of the renderer, never waits on detaching, and gives up after 5 seconds with "The browser tab is not responding" instead of hanging the action. A switch to another tab (and so a hand-back) no longer waits on the guard at all.
- **Only tabs an agent holds:** a tab is let through again, popups included, once no agent holds it (switched away, handed back, closed, or blanked by `closeTab`). `NavigationGuard.unwatch` and the new optional `BrowserSession.release()` do this; the next action guards the tab again.
- **Exemptions:** a name that resolves to an exempt address passes, and an exempt name written with a trailing dot matches.
- **DNS only where it means something:** the name check runs only on the local transport; the VM transport passes `resolveHost: null` (literals and local names only), since Chrome resolves on the VM. A lookup that takes more than 3 seconds leaves the name to Chrome.
