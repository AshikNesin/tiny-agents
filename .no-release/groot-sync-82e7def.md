# No release: groot sync to 82e7def

`pnpm groot:sync` from groot 1078881..82e7def (v3.0.0 → v3.0.0 local
checkout; upstream commits each carry their own changeset in groot). The kit
packages under `packages/**` are groot-owned synced copies and this child repo
does not publish them, so the sync records provenance here instead of version
bumps.

Local adaptations kept on top of the sync:

- `PageLayout` adopts upstream's self-contained header plus a tiny-agents
  phone-chrome extension: `ShellConfig.openNav` renders a phone-only menu
  button (the app's sidebar drawer), and a page's `backTo` renders a back
  button instead. `TopBar`/`ProfileButton` and `pageChrome` are gone; the app
  keeps its own desktop sidebar.
- The notification module (`packages/core/src/notification/**`) is a local
  fork of upstream's minimal one and is now excluded from sync
  (`.groot/boilerplate-sync.json`), along with upstream's
  `tests/server/core/notification.test.ts`, which targets the upstream API.
- Scripts and the test setup keep the app's `bootstrap()` wiring
  (`openAppDatabase`/`createAppDb`); upstream's `startWebApp`/`openDatabase`
  boot sequence is not adopted because the app still owns its boot.
- `tests/kit-consumers/` fixture adopted from upstream so the kit export
  guard agrees with the new exports maps.
- E2e now runs on a throwaway `data/e2e.db` (upstream) with the local faux
  gateway env vars kept.
