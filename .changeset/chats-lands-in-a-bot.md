---
"@groot/web": patch
---

`/chats` is no longer a page of its own on desktop: it opens the bot you
opened last (else the sidebar's top bot), so login, the logo and deleting
the open bot land in a conversation instead of an empty pane. The sidebar
drops its "Chats" row, since the Bots list is the way into chats. Phones
keep `/chats` as the bot list, and with no bots it is still the "Create
your first bot" screen.
