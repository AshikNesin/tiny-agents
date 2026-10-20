---
"@tiny-agents/agent": patch
---

Browser toolkit: resolve a system chromium on deploy images. The executable
chain now also picks up Debian's apt chromium (`/usr/bin/chromium`, installed
via `railpack.json` `aptPackages`) after the VM's headless shell and before
Playwright's bundled binary, so production deploys get a working browser with
no env vars. The "no browser installed" error now names all three fixes.
