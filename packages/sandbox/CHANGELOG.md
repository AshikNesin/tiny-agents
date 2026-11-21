# @tiny-agents/sandbox

## 0.1.1

### Patch Changes

- [#460](https://github.com/AshikNesin/tiny-agents/pull/460) [`190dede`](https://github.com/AshikNesin/tiny-agents/commit/190dedebb005421039ab584d3dc44e630ae44990) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Remove code comments (ADR 0028)

## 0.1.0

### Minor Changes

- [#271](https://github.com/AshikNesin/tiny-agents/pull/271) [`9c8c673`](https://github.com/AshikNesin/tiny-agents/commit/9c8c6732f5b5434e1d8b7e7c471f09b9503f7bf1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - New package `@tiny-agents/sandbox`: the sandbox VM layer without pi-durable (rewrite step 3.4, no behavior change).
  
  - **Moved:** the SSH connection (`ssh/`), terminal tabs (`terminal/`), the browser and computer session managers and their transports (local Chromium, remote CDP, X11), the browser and computer VM setup scripts, `createForwardingServer`, the in-process test SSH server, the public-URL guards and the vault's pi-durable-free pieces (`SecretValue`, `VaultTargetMovedError`) leave `@tiny-agents/agent` for `@tiny-agents/sandbox`. Subpaths: `./terminal`, `./browser`, `./computer`, `./testing`.
  - **Boundary:** the package imports neither pi-durable nor `@tiny-agents/agent`; lint R11 now covers it as well as `@tiny-agents/models`.
  - **`@tiny-agents/agent`:** depends on `@tiny-agents/sandbox`; the browser, computer and sandbox toolkits stay here and drive it. `./sandbox`, `./terminal`, `./browser` and `./computer` still export every name they exported before, and the root still exports `SecretFillField`, `checkPublicUrl` and `isPrivateAddress` and `./testing` `startFakeSandboxServer`, all re-exported from `@tiny-agents/sandbox` and marked `@deprecated`. Import them from `@tiny-agents/sandbox` instead. `SecretValue` and `VaultTargetMovedError` stay on the root as part of the vault port.

- [#273](https://github.com/AshikNesin/tiny-agents/pull/273) [`d93a971`](https://github.com/AshikNesin/tiny-agents/commit/d93a971495499fd3d927895f13eacdbb89a1deaf) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One VM stack and one shell module (rewrite step 3.6, no behavior change).
  
  - **New root exports:** `bashScript`, `exitWith`, `exitSentinel` and `failureDetail` join `shQuote`, which now comes from the same module. Every command sent to the sandbox VM is quoted, wrapped and has its exit code read through them.
  - **Unchanged:** every script the browser, the computer, the Claude worker, confined commands and the terminal send over SSH is byte-for-byte what it was, so existing VMs keep their markers, locks and pid files.

### Patch Changes

- [#278](https://github.com/AshikNesin/tiny-agents/pull/278) [`2677cc6`](https://github.com/AshikNesin/tiny-agents/commit/2677cc6fddbc652e02bc17cd89ac64c9df690a78) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Navigation guard fixes (S7 follow-up).
  
  - **No hang on a busy tab:** the guard asks the browser process for a tab's id (`Target.getTargetInfo`) instead of the renderer, never waits on detaching, and gives up after 5 seconds with "The browser tab is not responding" instead of hanging the action. A switch to another tab (and so a hand-back) no longer waits on the guard at all.
  - **Only tabs an agent holds:** a tab is let through again, popups included, once no agent holds it (switched away, handed back, closed, or blanked by `closeTab`). `NavigationGuard.unwatch` and the new optional `BrowserSession.release()` do this; the next action guards the tab again.
  - **Exemptions:** a name that resolves to an exempt address passes, and an exempt name written with a trailing dot matches.
  - **DNS only where it means something:** the name check runs only on the local transport; the VM transport passes `resolveHost: null` (literals and local names only), since Chrome resolves on the VM. A lookup that takes more than 3 seconds leaves the name to Chrome.

- [#278](https://github.com/AshikNesin/tiny-agents/pull/278) [`2677cc6`](https://github.com/AshikNesin/tiny-agents/commit/2677cc6fddbc652e02bc17cd89ac64c9df690a78) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Close the rest of the SSRF gaps (security fix, S7 follow-up).
  
  - **Browser:** a new navigation guard (`navigationGuard`, one browser-level DevTools session per browser) checks every main-frame request of an agent's tab before it is sent, for the tab's whole life, and of every popup such a tab opens. A meta refresh, a script setting `location`, a click and `window.open` to a private address are now refused, as redirect hops already were, and a name that resolves to a private address (`127.0.0.1.nip.io`) is refused too. Both transports pass the guard to `pageSession` (new `guard` option); `navigate` refuses to run without one. Tabs no agent holds are not guarded, nor are subframes and subresources.
  - **Addresses:** `isPrivateAddress` (and so `checkPublicUrl` and `http_request`'s DNS check) also refuses 192.0.0.0/24, 192.0.2.0/24 and 198.18.0.0/15, IPv6 site-local and multicast, local-use NAT64, and IPv6 forms that embed a private IPv4: compatible (`::127.0.0.1`), SIIT, NAT64 and 6to4. Zone ids are ignored.
  - **`http_request`:** a redirect's body is released before the too-many-redirects error, closing a pinned agent never leaves an unhandled rejection, and `createWebToolkit`'s `fetch` option is now TinyFish's only: every `http_request` goes through `sendPinned` (default `pinnedFetch`).
  - **Auto-review:** when the owner's id can't be looked up, the call shows its approval card instead of failing.

- [#278](https://github.com/AshikNesin/tiny-agents/pull/278) [`2677cc6`](https://github.com/AshikNesin/tiny-agents/commit/2677cc6fddbc652e02bc17cd89ac64c9df690a78) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Close three SSRF gaps (security fix, S7).
  
  - **`checkPublicUrl`** (`@tiny-agents/sandbox`) classifies a host by what it is: an IP literal goes through `isPrivateAddress`, so CGNAT (`100.64.0.0/10`), IPv4-mapped IPv6 (`[::ffff:127.0.0.1]`, also in its hex form `[::ffff:7f00:1]`), multicast and `[::]` are now refused, and a name is only refused when it is local (`localhost`, `localhost.`, `.localhost`, `.local`, `.internal`), so `10.example.com` is allowed again. `isPrivateAddress` also recognizes the hex form of a mapped address.
  - **Browser navigation** checks each redirect hop of the main frame before its request is sent (DevTools `Fetch` interception during `navigate`), instead of after the page loaded, so a refused hop never reaches the private address. The error is the same: `Blocked: the page redirected to a private address (host).`
  - **`http_request`** (`@tiny-agents/agent`) resolves each hop's host once, checks every address, and connects only to those addresses (a pinned lookup on an `undici` agent), so a second DNS answer can't swap in a private one. `createWebToolkit` takes a `sendPinned` option for tests, and `pinnedFetch` is exported.
