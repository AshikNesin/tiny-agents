---
"tiny-agents": minor
---

Run locally and update from the app: `pnpm local`.

- **`pnpm local`** runs the production server from a built release and checks git for new commits. It follows `origin/main` by default, or the newest release with `--track release`.
- **Settings → Updates** shows the running version, the new commits, and an **Update & restart** button. The new version builds while the old one keeps serving, then the server restarts and the page reloads.
- **Safe swaps:** a failed build leaves the running version alone, a version that does not start is rolled back, and a crashed server is restarted. `--auto` updates without the click.
