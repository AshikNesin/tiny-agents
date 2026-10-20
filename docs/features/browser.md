# Browser Feature

First-class browser capability (issue #24): each bot can drive a real
Chromium; the owner watches the viewport live in the chat UI and can take
control mid-run, including typing secrets that must never reach the model.

## Architecture

```
One browser per bot, one profile dir per bot (remote: on the VM; local: ./data/browser-profiles/<id>)

Remote (SANDBOX_HOST set — production):
VM headless-shell ─ CDP on 127.0.0.1 (VM-only, ephemeral port)
  └─ SSH tunnel (keyless Tailscale) ─► playwright-core connectOverCDP in the app

Local fallback (no SANDBOX_HOST):
in-process Playwright persistent context (headless=new), no CDP port

Both:
CDP session per page
  ├─ Page.startScreencast ─► JPEG frames ─► SSE feed ─► blob URLs ─► <img> in BrowserPanel
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

| Method | Path                               | Description                                       |
| ------ | ---------------------------------- | ------------------------------------------------- |
| GET    | `/api/v1/bots/:id/browser`         | `{ active, url, driver }`                         |
| GET    | `/api/v1/bots/:id/browser/live`    | SSE frame feed (JWT; `<img>` painted client-side) |
| POST   | `/api/v1/bots/:id/browser/input`   | mouse / scroll / key event                        |
| POST   | `/api/v1/bots/:id/browser/driver`  | `{ driver: "agent" \| "human" }`                  |
| DELETE | `/api/v1/bots/:id/browser/profile` | close + wipe the profile                          |

## Security rules

- No CDP port is reachable from outside: local fallback never binds one
  (Playwright over a pipe); on the VM it binds to 127.0.0.1 only, reachable
  solely through the SSH tunnel from the app.
- Navigation passes the same private-address rules as `web_fetch`
  (`checkPublicUrl`); `BROWSER_ALLOWED_PRIVATE_HOSTS` exempts named hosts.
- Secrets: the masked field in takeover mode sends keystrokes straight to
  the page. Tool results never echo typed text; nothing is logged.
- All action tools are approval-gated like every effectful capability
  (default ask, per-conversation always-allow).

## Env

`BROWSER_EXECUTABLE_PATH`, `BROWSER_IDLE_MINUTES`,
`BROWSER_ALLOWED_PRIVATE_HOSTS` (all optional; see `.env.schema`).

**Where chromium runs** — on deploys, not in the app container:

- `SANDBOX_HOST` set (production): the browser runs **on that VM**. Each bot
  session SSHes in (keyless Tailscale, same channel as the sandbox toolkit),
  starts a per-profile headless-shell with CDP bound to 127.0.0.1 on the VM,
  and tunnels it back through the same connection. No browser bytes in the
  app container; no exposed ports; closing a session kills the remote
  chromium.
- `BROWSER_EXECUTABLE_PATH` set: a local binary (dev overrides).
- Neither: local fallbacks — `/headless-shell/headless-shell` (exe.dev VM),
  `/usr/bin/chromium` (Debian apt, via `railpack.json` `aptPackages`), then
  Playwright's bundled Chromium (`pnpm exec playwright install chromium`).

Without any of these, `browser_navigate` returns a setup hint naming the
options and nothing else breaks.

Tailscale-SSH realities the remote transport encodes (verified live): after
a direct-tcpip channel closes, later channels on the same connection stall —
each incoming socket dials a fresh SSH connection; and the ~50ms dial must
buffer the socket's first bytes or CDP's opening HTTP request is lost.
