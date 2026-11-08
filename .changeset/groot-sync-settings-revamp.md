---
"@groot/shell": minor
"tiny-agents": minor
---

Synced groot's settings revamp and Amp-style account menu (groot `4fda966`, after `b1661dd`).

- **Full-page settings.** Settings is now a screen of its own (upstream `56dfce8`): a slim "Back to app" bar, a left sidebar with a searchable, grouped section list (`/` to focus; arrows move, Enter opens, Esc clears) and one sub-route per section — `/settings/account`, `appearance`, `security`, `models`, `notifications`, `people`, `configuration`. The app sidebar is hidden there. `mod+,` opens Settings from anywhere; the old `?tab=` links now go to their section path (`/settings/models`).
- **Amp-style account menu.** The sidebar's account menu follows upstream `4fda966`: Log out on top, then a Command palette row (⌘K), then the destinations with Settings last, next to the trigger. Send feedback stays at the bottom.
- **Adopted upstream kit versions.** `@groot/core` 2.1.0, `@groot/shell` 2.1.0, `@groot/ui` 1.1.0, `@groot/jobs` 2.0.1 with their changelogs, so future version-bump syncs merge cleanly.
