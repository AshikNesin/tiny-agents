---
"@tiny-agents/agent": minor
"@groot/web": minor
---

A browser session manager and one SSH connection module.

- `createBrowserSessions(options)` owns which browsers are live: lazy open,
  shared launches, the driver flag (action tools now wait on the owner's
  hand-back instead of polling), the idle sweep on an injectable clock, and
  `peek`, which never launches a browser. Closing a browser that is still
  opening cancels the open, so a reset or wipe can no longer come back as a
  browser that finished opening after it. The app creates one manager
  (`browser.sessions.ts`) and hands it to the toolkit (`sessions` option)
  and its routes; the module-level `startBrowserSession`, `setDriver`,
  `closeBrowserSession`, `closeBrowserTab`, `getLiveBrowserSession`,
  `browserOpenState`, `browserProfilesDir`, `liveBrowserProfiles`,
  `fillSecretInBrowser`, `browserTabOrigin` and `resetBrowserSessionsForTests`
  exports are gone (`closeAllBrowserSessions` stays and closes every
  manager). The vault sinks and the credential request sheet moved to
  `browser-vault.ts`; `browser-guard.ts` holds the ref and URL rules so the
  transports no longer import the toolkit. Gate plans no longer start a
  browser to plan a fill.
- `ssh/connection.ts` is the one dial for the sandbox toolkit, the terminal
  and the browser's CDP tunnel: TOFU host-key pinning against one
  `HostKeyStore` (the CDP tunnel now pins too), an `error` listener that
  outlives the handshake (ssh2's second error after a timeout no longer
  crashes the server), the channel pool and `PreDispatchError`. The sandbox
  toolkit closes a pooled session that failed instead of dropping it with
  its keepalive running, and the terminal rebinds when the sandbox endpoint
  changes. The app reads one `sandboxEndpoint()` (host, port, user and one
  kv-backed key store under `SANDBOX`) for every SSH user; the terminal's
  separate `TERMINAL` pins are no longer written.
