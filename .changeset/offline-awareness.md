---
"@groot/web": patch
---

Chat knows when you are offline. Going offline used to leave the chat looking
live while nothing arrived, and a message sent meanwhile failed with a brief
"Network Error". Now a "You're offline" notice shows right away, the live
stream reconnects (with a fresh copy of the chat) the moment you are back
instead of after its retry delay, and a message you sent while offline stays in
the box and sends by itself once you are back online.
