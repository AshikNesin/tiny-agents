---
"@tiny-agents/agent": patch
"@tiny-agents/sandbox": patch
"tiny-agents": patch
---

Submitting a bot's credential request with **Save to the vault** on now needs the vault step-up token, because the save path can overwrite the login that is already stored for that site (the same re-confirmation every other vault write asks for). Filling the page without saving is unchanged, and both web and Android clients ask for the password confirmation in the dialog before the request goes out.

The Claude Code engine now enforces the same 150-tool-calls-per-reply cap as the pi engine, so a looping session is refused and stopped instead of running host-side tools forever.

The loopback CDP forwarder that exposes the sandbox browser's DevTools port requires a per-session token header (`x-cdp-token`) generated with Web Crypto at forwarder start: a client without the token gets `403` and its socket closed, so another local process can no longer take over the browser session. The token is known only to the transport that started the forwarder and is passed to its own Playwright connection.
