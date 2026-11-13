---
"tiny-agents": patch
"@groot/core": patch
---

Fixes from an end-to-end pass (friction issues #240–#244).

- **Test servers can sign in for every test (#240):** `AUTH_RATE_LIMIT_MAX` overrides the 20 sign-ins per 15 minutes. `pnpm test:e2e` and `ta-verify up` set it to 1000, and both login helpers now say when a login was rate-limited instead of failing as "still on /login".
- **Old settings links work (#241):** `/settings?tab=<id>` opens `/settings/<id>` (`general` → Account, `claude` → Models). The verify journeys follow the full-page Settings, and a client test fails when a journey or recipe names a page that no longer exists.
- **No dead end on /code (#242):** with no coding agent, the page keeps its "Back to tiny-agents" bar and links Settings → Models.
- **E2E in containers (#243):** `pnpm test:e2e` launches `PLAYWRIGHT_CHROMIUM_PATH`, or a Chromium pre-installed at `/opt/pw-browsers/chromium` when Playwright's own build is missing.
- **Quieter logs (#244):** 4xx errors are logged without a stack trace, and the session guard's 401 (every signed-out page load) at debug. `@groot/core/session` exports `isSessionInvalid()`.
