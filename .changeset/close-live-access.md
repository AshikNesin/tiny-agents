---
"tiny-agents": patch
---

Removing a guest, or unsharing a bot from them, now ends what they already
hold open. Before, a removed guest's open chat stream, `/events` feed, Code
streams and desktop live view kept running until the browser disconnected,
and a live-view ticket minted in the last minute still opened a viewer.
Unsharing a bot left that bot's chat stream and live view open the same way.

Every SSE stream, open desktop viewer and unredeemed viewer ticket is now
held in one registry of live access (`api/people/live-access.ts`) under its
person and, when it shows one bot, that bot. `removeGuest` closes everything
the guest holds; `setBotGuests` closes what each dropped guest holds on that
bot. Registering re-checks the account and the share synchronously, so a
stream or ticket opened by a request that passed its access check before a
revocation landed is closed at once. Viewers close with WebSocket code 1008,
stop forwarding input while closing, and are cut a second later.
