---
"@groot/web": minor
---

Computer page: `/computer` (in the sidebar beside Terminal) shows the bots'
desktops on the sandbox VM, one tab per desktop (the shared one and one per
bot with its own browser profile). Each streams live and can be driven
directly: Take control pauses the bots on it (and answers a bot's takeover
request on release), and while driving the page opens installed apps, sends
the shortcuts the local browser would keep (Alt+Tab, Alt+F4, Ctrl+W, Alt+F1
menu, Ctrl+Alt+T terminal), pastes the clipboard, goes full screen, and
starts or resets a desktop. New routes under `/api/v1/computer` and a
`/computer/:profile/vnc` viewer socket with its own tickets; the chat's
Computer panel links to the page.
