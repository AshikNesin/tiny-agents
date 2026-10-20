# Browser Feature

First-class browser capability (issue #24): each bot can drive a real
Chromium; the owner watches the viewport live in the chat UI and can take
control mid-run, including typing secrets that must never reach the model.

## Architecture

```
Chromium persistent context, one profile dir per bot (./data/browser-profiles/<id>)
  └─ in-process Playwright (headless=new), no remote-debugging port ever
CDP session per page
  ├─ Page.startScreencast ─► JPEG frames ─► MJPEG response ─► <img> in BrowserPanel
  └─ Input.dispatch*       ◄─ agent tools AND human input (peer channel)
```

- Toolkit: `packages/agent/src/toolkits/browser.ts` (port + tools),
  `browser-chromium.ts` (Playwright transport). Wired in
  `bots.runtime.ts` beside the sandbox.
- Perception: `browser_snapshot` injects `data-ta-ref` attributes and
  returns a ref-annotated element tree; actions take refs. Vision is the
  `browser_screenshot` fallback.
- Driver flag: `setDriver(conversationId, "agent" | "human")`. Action tools
  wait (bounded) while the human drives; the next snapshot absorbs whatever
  the human did. No focus lock — human and agent are input peers.
- Sessions: lazy start on first browser tool call, idle-closed after 10 min
  (`BROWSER_IDLE_MINUTES`), `DELETE /bots/:id/browser/profile` wipes the
  profile for a fresh identity.

## API

| Method | Path                               | Description                       |
| ------ | ---------------------------------- | --------------------------------- |
| GET    | `/api/v1/bots/:id/browser`         | `{ active, url, driver }`         |
| GET    | `/api/v1/bots/:id/browser/live`    | MJPEG stream (JWT cookie `<img>`) |
| POST   | `/api/v1/bots/:id/browser/input`   | mouse / scroll / key event        |
| POST   | `/api/v1/bots/:id/browser/driver`  | `{ driver: "agent" \| "human" }`  |
| DELETE | `/api/v1/bots/:id/browser/profile` | close + wipe the profile          |

## Security rules

- No CDP port is bound anywhere; Playwright talks over a pipe.
- Navigation passes the same private-address rules as `web_fetch`
  (`checkPublicUrl`); `BROWSER_ALLOWED_PRIVATE_HOSTS` exempts named hosts.
- Secrets: the masked field in takeover mode sends keystrokes straight to
  the page. Tool results never echo typed text; nothing is logged.
- All action tools are approval-gated like every effectful capability
  (default ask, per-conversation always-allow).

## Env

`BROWSER_EXECUTABLE_PATH`, `BROWSER_IDLE_MINUTES`,
`BROWSER_ALLOWED_PRIVATE_HOSTS` (all optional; see `.env.schema`).

**Binary resolution order** — no env var required on our deploys:

1. `BROWSER_EXECUTABLE_PATH` if set
2. `/headless-shell/headless-shell` (the exe.dev VM's pre-provisioned shell)
3. `/usr/bin/chromium` (Debian's apt chromium; `railpack.json` installs it
   into the deploy image via `aptPackages`)
4. Playwright's bundled Chromium (requires
   `pnpm exec playwright install chromium` in the build)

Without any of these, `browser_navigate` returns a setup hint naming all
three options and nothing else breaks.
