# Phone stills

| File                                    | What it is                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat-waiting.png`, `chat-approved.png` | **Real renders** of the Android app's own Compose UI (Roborazzi and Robolectric on the JVM, no emulator), 412x892 dp at 3x, light theme, with the sample data from `../CAST.md`. `*-bare.png` are the same without the status bar.                                                                                                   |
| `chat-positions.json`                   | Where the Approve button, the card and the other parts are, in pixels and dp.                                                                                                                                                                                                                                                        |
| `lockscreen.html`, `lockscreen.png`     | **Rebuilt**: a plain Android lock screen with the push. The title and message are the strings the server sends for a waiting vault approval (`apps/web/src/server/api/notifications/notifications.events.ts`). The push goes through Pushover, so the notification carries that app's name as text, with a neutral icon and no logo. |
| `lock-empty.png`, `lock-notif.png`      | The lock screen and the notification as separate layers, so the film can drop the notification in.                                                                                                                                                                                                                                   |

Re-render:

```sh
scripts/demo/launch/tools/android/render.sh              # the chat stills (needs JDK 21 and an Android SDK with platform 37)
node scripts/demo/launch/tools/android/preview-lockscreen.mjs
node scripts/demo/launch/tools/android/lock-parts.mjs
```

`render.sh` copies `DemoPhoneScreenshotTest.kt` into the app's test sources for the run and removes it afterwards, so `mobile/` is left unchanged.
