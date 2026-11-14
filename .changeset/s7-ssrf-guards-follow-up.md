---
"@tiny-agents/sandbox": patch
"@tiny-agents/agent": patch
---

Close the rest of the SSRF gaps (security fix, S7 follow-up).

- **Browser:** a new navigation guard (`navigationGuard`, one browser-level DevTools session per browser) checks every main-frame request of an agent's tab before it is sent, for the tab's whole life, and of every popup such a tab opens. A meta refresh, a script setting `location`, a click and `window.open` to a private address are now refused, as redirect hops already were, and a name that resolves to a private address (`127.0.0.1.nip.io`) is refused too. Both transports pass the guard to `pageSession` (new `guard` option); `navigate` refuses to run without one. Tabs no agent holds are not guarded, nor are subframes and subresources.
- **Addresses:** `isPrivateAddress` (and so `checkPublicUrl` and `http_request`'s DNS check) also refuses 192.0.0.0/24, 192.0.2.0/24 and 198.18.0.0/15, IPv6 site-local and multicast, local-use NAT64, and IPv6 forms that embed a private IPv4: compatible (`::127.0.0.1`), SIIT, NAT64 and 6to4. Zone ids are ignored.
- **`http_request`:** a redirect's body is released before the too-many-redirects error, closing a pinned agent never leaves an unhandled rejection, and `createWebToolkit`'s `fetch` option is now TinyFish's only: every `http_request` goes through `sendPinned` (default `pinnedFetch`).
- **Auto-review:** when the owner's id can't be looked up, the call shows its approval card instead of failing.
