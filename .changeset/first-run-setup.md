---
"@groot/core": minor
"@groot/shell": minor
---

Add first-run setup: create the first user from the browser at `/setup`.

`@groot/core` adds `GET /api/v1/auth/setup` (`{ needsSetup }`) and
`POST /api/v1/auth/setup`, which creates the first account and signs it in
(cookie + token, like login). It answers 403 once any user exists and is
rate-limited like login. The service gains `hasAnyUser()` and
`createFirstUser()`; the schema exports `SetupStatus`.

`@groot/shell` adds the `Setup` page (`@groot/shell/pages/auth/Setup`), the
`useSetupStatus()` hook and the store's `setup()` action. `Login` redirects to
`/setup` while no user exists, and `Setup` redirects to `/login` once one
does. Apps mount it with `<Route path="/setup" element={<Setup />} />`.
