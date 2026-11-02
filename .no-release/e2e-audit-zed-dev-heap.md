# No release: Zed debug config and dev-server heap cap

`.zed/debug.json` pointed at the pre-3.0 `server/src/index.ts` and its
wrapper still routed node through varlock, which the groot 3.0 sync
removed; both now match the Hono entry. `scripts/dev.ts` and
`playwright.config.ts` raise `--max-old-space-size` to 1024 (512
OOM-crashed while booting the tiny-agents server). No published package
is affected.
