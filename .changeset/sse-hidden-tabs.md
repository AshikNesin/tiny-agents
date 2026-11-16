---
"tiny-agents": patch
---

Requests no longer hang when the app is open in several tabs. Each tab's live updates held one of the 6 connections a browser allows per site over plain `http://localhost`, so with two Code tabs (or Code and a couple of chats) open, new requests such as a thread's PR tab or Changes waited forever. A tab in the background now gives its live connections back and reconnects, with fresh data, as soon as it is shown.
