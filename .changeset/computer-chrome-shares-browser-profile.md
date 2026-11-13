---
"tiny-agents": minor
"@tiny-agents/agent": minor
---

The computer's Chrome and the Browser feature now use the same Chrome profile.

- **One profile, two views:** Chrome opened on a desktop (the menu, the Web Browser launcher, `computer_open_app`) opens the browser profile of the same key (`shared`, or a bot's own). A site you sign into in either one is signed in in the other, along with history, bookmarks and extensions.
- **Handoff:** Chrome lets only one running browser use a profile. Opening Chrome on the desktop closes the bot's browser on that profile, and the bot's next browser call closes the desktop's Chrome and reopens it in the Browser panel. Cookies are saved on each handoff.
- **Reset:** resetting a browser profile also closes the desktop's Chrome on it.
