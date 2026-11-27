---
"tiny-agents": minor
---

The vault asks you to confirm it's you only when a value could leave it: revealing, copying, deleting, linking an existing 1Password item, or changing an item's URLs or policy. Adding an item, changing its title or values, saving a sign-in a bot asked for, and moving local items to 1Password no longer ask. The Android app can confirm with a passkey (fingerprint or face): with `ANDROID_APP_CERT_SHA256` set, the server's `/.well-known/assetlinks.json` now also lets the app use the server's passkeys, and the server accepts passkey answers signed for the app.
