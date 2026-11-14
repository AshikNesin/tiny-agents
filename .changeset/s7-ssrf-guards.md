---
"@tiny-agents/sandbox": patch
"@tiny-agents/agent": patch
---

Close three SSRF gaps (security fix, S7).

- **`checkPublicUrl`** (`@tiny-agents/sandbox`) classifies a host by what it is: an IP literal goes through `isPrivateAddress`, so CGNAT (`100.64.0.0/10`), IPv4-mapped IPv6 (`[::ffff:127.0.0.1]`, also in its hex form `[::ffff:7f00:1]`), multicast and `[::]` are now refused, and a name is only refused when it is local (`localhost`, `localhost.`, `.localhost`, `.local`, `.internal`), so `10.example.com` is allowed again. `isPrivateAddress` also recognizes the hex form of a mapped address.
- **Browser navigation** checks each redirect hop of the main frame before its request is sent (DevTools `Fetch` interception during `navigate`), instead of after the page loaded, so a refused hop never reaches the private address. The error is the same: `Blocked: the page redirected to a private address (host).`
- **`http_request`** (`@tiny-agents/agent`) resolves each hop's host once, checks every address, and connects only to those addresses (a pinned lookup on an `undici` agent), so a second DNS answer can't swap in a private one. `createWebToolkit` takes a `sendPinned` option for tests, and `pinnedFetch` is exported.
