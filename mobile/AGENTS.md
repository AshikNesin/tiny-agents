# AGENTS.md

groot-mobile-app is a native Android (Kotlin + Compose) and iOS (Swift + SwiftUI) boilerplate.
Improvements land here and sync down to child apps; child fixes go back upstream as PRs.
The full design is in `docs/rfcs/0001-groot-mobile-app.md`.

## Where code goes

| You're changing | Put it in | Synced? |
|---|---|---|
| Screens, ViewModels, navigation, data, custom components | `android/app/`, `ios/App/` | Never — app-owned |
| Brand colors and spacing | `android/app/src/main/kotlin/groot/mobile/ui/brand/`, `ios/App/Sources/UI/Brand/` | Never |
| Theme, tokens, settings screen, build info, logging | `android/kit/`, `ios/GrootKit/` | Yes — read-only in children |
| Gradle conventions | `android/build-logic/` | Yes |
| Versions | `android/version.properties`, `ios/App/Config/Version.xcconfig` | Never |

In a child app, never edit kit files. Copy what you need into app code, or send the fix upstream with
`pnpm groot:upstream`. See `docs/guides/customizing-ui.md`.

## Rules and enforcers

| Rule | Enforcer |
|---|---|
| The kit never imports app code, ViewModels, navigation, networking or databases | `pnpm check:boundaries` |
| No hardcoded colors or dp values outside kit tokens and the app's `brand/` folder | `pnpm check:tokens` |
| Kit files stay unedited in children | `pnpm check:kit-edits` (warns) |
| Versions live in `android/version.properties`, never in build files | `pnpm check:boundaries` |
| Every path a doc mentions exists | `pnpm check:doc-refs` |
| Every change ships with a changeset (`pnpm changeset`; `--empty` for docs/CI-only) | `changeset status` in CI on PRs |
| Kit public API is explicit (`public`, return types) | Kotlin explicit API mode in `groot.android.library` |
| No new dependency without a size-budget note in the PR | `pnpm size:android`, `pnpm size:ios` (3 MB download budget each) + review |

## Commands

```bash
pnpm check            # everything CI runs; skips platforms this machine can't build, and says so
pnpm android:test     # JUnit + Robolectric + Compose UI tests
pnpm android:lint
pnpm size:android     # release AAB -> bundletool download size vs. budget
pnpm ios:test         # (macOS) kit + app unit tests on the simulator
pnpm ios:lint         # (macOS) SwiftLint
pnpm size:ios         # (macOS) iOS download size vs. budget
pnpm screenshots      # renders reference screens to android/app/build/outputs/roborazzi/
pnpm groot:check      # (child apps) what would sync from the boilerplate
```

Setup and prerequisites: `docs/quick-start.md`.

## Conventions

- Small files, one concept each. Screens are stateless composables; a `...Route` wrapper connects a ViewModel.
- Read colors from `MaterialTheme.colorScheme` / `GrootTheme.colors` and spacing from `S` (e.g. `S.lg`).
- Unit tests use fakes passed by constructor: no network, clock or real disk.
- Compose performance: Strong Skipping is on; don't add `@Stable`/`@Immutable` without a measured problem.
  Hoist state, don't allocate new parameter objects per recomposition, use `derivedStateOf` for fast-changing derived values.
- Background work: none in the kit. Apps follow `docs/guides/android.md` (wake-lock vital).

## This app

<!-- Child apps: your own agent notes go below this line. Sync never conflicts with this section. -->

This is Tiny Agents for Android, the native client of the tiny-agents server in the parent repo. It is Android
only (`ios/` is excluded from sync). The app guide is `docs/app/README.md`.

- **Where code goes.** Screens, ViewModels, the API client, stores and the chat reducer: `android/app/`. The RFB
  (VNC) client and viewer: `android/vnc/`. The xterm emulator and view: `android/terminal/`. The two protocol
  modules take byte streams and know nothing about tiny-agents; wiring them to the server stays in
  `android/app/`.
- **Wire types** in `android/app/src/main/kotlin/groot/mobile/data/api/` mirror the server's
  `apps/web/src/shared/api/` and `apps/web/src/shared/bot-stream.ts` field for field. When a server type changes,
  change the Kotlin type in the same change.
- **Chat rules** in `android/app/src/main/kotlin/groot/mobile/data/chat/` are ports of the web client's
  `lib/chat-session.ts`, `lib/tool-call-text.ts` and `lib/tool-call-view.ts`. Change both clients together.
- **Live-server tests.** In the tiny-agents repo run
  `.agents/skills/verify-tiny-agents/scripts/ta-verify.mjs up` (add `--sandbox` with a sandbox), then in
  `android/`:
  `TINY_AGENTS_URL=http://localhost:3100 ./gradlew :app:testDebugUnitTest --tests groot.mobile.LiveServerTest --rerun`.
  `SandboxLiveTest` also needs `TINY_AGENTS_SANDBOX=1`. Without these variables both tests are skipped.
