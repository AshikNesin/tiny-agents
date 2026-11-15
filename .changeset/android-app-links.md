---
"tiny-agents": minor
---

Push notification links can open the Android app: set `ANDROID_APP_CERT_SHA256` to the app's signing certificate SHA-256 and the server serves `/.well-known/assetlinks.json`, so Android lets the app open this server's links (a notification's approval or question opens the app on that card instead of the browser). See the mobile app guide, "Links from notifications".
