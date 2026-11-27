# @tiny-agents/sandbox

## 0.2.0

### Minor Changes

- [#509](https://github.com/AshikNesin/tiny-agents/pull/509) [`7c34436`](https://github.com/AshikNesin/tiny-agents/commit/7c3443651e369eb579b5aa32c30ff7d90a7e4b45) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code has a third agent, Native, built on the same runtime the chat bots use. It needs a sandbox and a model that runs on pi, and no other setup. A Native thread reads, writes and edits files and runs commands in its working directory on the sandbox, asks before it changes anything unless its permission mode says otherwise, takes a steer or a queued message while it works, and can be stopped, forked, compacted and continued after an error. Settings → Models has a new default, New Code threads, for the model a Native thread starts on.
  
  For developers: `AgentRuntime` gains `cwd` on a conversation's config, `fork`, `compact` and `continueReply`; `@tiny-agents/agent` exports `createCodingToolkit` and `codingSelection`; `@tiny-agents/code/server` exports `createPiHarness` and its `PiPort`; the model catalog has a `code_default` role; and a sandbox `exec` takes an abort `signal`.

### Patch Changes

- [`aa491b1`](https://github.com/AshikNesin/tiny-agents/commit/aa491b10e52ac4c00abafe8a55b5f83548ff606a) Thanks [@ampagent](https://github.com/ampagent)! - Submitting a bot's credential request with **Save to the vault** on now needs the vault step-up token, because the save path can overwrite the login that is already stored for that site (the same re-confirmation every other vault write asks for). Filling the page without saving is unchanged, and both web and Android clients ask for the password confirmation in the dialog before the request goes out.
  
  The Claude Code engine now enforces the same 150-tool-calls-per-reply cap as the pi engine, so a looping session is refused and stopped instead of running host-side tools forever.
  
  The loopback CDP forwarder that exposes the sandbox browser's DevTools port requires a per-session token header (`x-cdp-token`) generated with Web Crypto at forwarder start: a client without the token gets `403` and its socket closed, so another local process can no longer take over the browser session. The token is known only to the transport that started the forwarder and is passed to its own Playwright connection.

- [`e511da5`](https://github.com/AshikNesin/tiny-agents/commit/e511da53df9f14db7849c0cdf861c34e2689baac) Thanks [@ampagent](https://github.com/ampagent)! - Memory capture no longer loses the oldest owner turns when a conversation backlog exceeds the 24,000-character window: the window now starts at the watermark and the watermark only advances past what was actually captured, so skipped messages are picked up by the next run.
  
  The weekly memory tidy aborts without changing anything if a memory was edited during its model call, instead of overwriting the owner's edit with text derived from the stale snapshot.
  
  Two concurrent `update_instructions` calls can no longer lose an append: the prompt revision and the new prompt are written in one transaction guarded by a conditional update, retried when another writer got there first.
  
  A resumed `update_instructions` call now reports it was interrupted instead of appending the same lines a second time (its replay policy is `unsafe`, like other side-effecting tools).
  
  `list_tasks` now returns only open tasks (`todo` and `in_progress`) when no status filter is passed, matching its description; pass `status: "done"` to see completed tasks.
  
  A detached `run_command` under the egress allowlist keeps running past the call: it is started as its own transient systemd unit (egress-restricted, no runtime cap) instead of being killed with the wrapper the moment the call returns. Detached commands never accept secrets, as before.
  
  tmux session geometry is validated as integers within the documented ranges before it is interpolated into the shell command, so no caller can smuggle a payload through cols or rows.
  
  `search_attachment` with `regex: true` refuses patterns whose alternation under a quantifier is ambiguous (for example `(a|a)*`, `(a|aa)+$`, `((a|a)*)*b`), the classic catastrophic-backtracking shapes the nested-quantifier check missed. Benign alternations like `^(a|b)c$` still work.

- [`e511da5`](https://github.com/AshikNesin/tiny-agents/commit/e511da53df9f14db7849c0cdf861c34e2689baac) Thanks [@ampagent](https://github.com/ampagent)! - Vault credentials stay off plaintext http. `http_request` with a vault handle refuses an `http://` URL up front, and a redirect from `https` to `http` on the same host fails before the credential is sent, instead of leaking it to anyone listening on the wire. Plain `http_request` calls without a vault item are unchanged.
  
  A vault approval card now shows the whole command `run_command` can run (up to 20,000 characters, matching the tool's limit) instead of a 2,000-character prefix, so the owner approves what actually runs.
  
  A guest who answers a bot's `ask_owner` questions is named in the answer the model reads ("Priya (guest) answered your questions"), instead of being presented as the owner's own decision.
  
  A vault value filled into a page is no longer handed to frames whose origin the item does not allow: the fill used to serialize the secret into every frame before checking the allowlist, so a cross-origin iframe could read it. It now reaches only the page's own origin and the origins the item names.

## 0.1.2

### Patch Changes

- [#489](https://github.com/AshikNesin/tiny-agents/pull/489) [`c341801`](https://github.com/AshikNesin/tiny-agents/commit/c341801dc6a04579e30cec364f8b608e6552c507) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The sandbox browser sends all of its traffic through a proxy that resolves each name once, refuses private and local answers, and connects to the address it checked, so DNS rebinding can't reach a private host. It runs in the server for the local browser and next to Chrome on the sandbox VM, and covers a page's own requests too. In the live view, a private or tailnet address now opens only when it is in `BROWSER_ALLOWED_PRIVATE_HOSTS`.

- [#480](https://github.com/AshikNesin/tiny-agents/pull/480) [`feab2c2`](https://github.com/AshikNesin/tiny-agents/commit/feab2c2102bcc0022e5ff24cbcb6bd09f43bc6c7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The local browser's navigation guard refuses a name whose DNS lookup fails or times out, instead of leaving it to the browser, so a name that can't be checked can't reach a private address. An exempt name still goes through.

- [#478](https://github.com/AshikNesin/tiny-agents/pull/478) [`2870261`](https://github.com/AshikNesin/tiny-agents/commit/2870261fd61ba1910258bc72144a0aa24f8155c1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The live browser and computer routes look the target up before reading the body, so a request bad on both counts is always 404. Upload extraction no longer reads `VITEST`: the runner is a port (`setExtractRunner`) the server test setup sets to in-process. `scripts/` is under the server typecheck and the typecheck coverage guard. The test SSH server types its SFTP stream with ssh2's `SFTPWrapper`, and now sends real SFTP attributes and REALPATH names. The agent's browser-safe `wire` subpath has a path alias like `peer-envelope`'s.

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
