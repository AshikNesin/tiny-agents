---
"tiny-agents": patch
---

Browser: sites behind a bot check (amazon.in, Cloudflare) open. `browser_navigate` waits through a challenge page that solves itself instead of returning its empty 202, and Chrome tells sites the owner's language and time zone (`BROWSER_LOCALE`, default `en-IN`; `BROWSER_TIMEZONE`, default `Asia/Kolkata`) instead of the VM's en-US and UTC. The local headless browser no longer reports `navigator.webdriver` or a `HeadlessChrome` user agent.
