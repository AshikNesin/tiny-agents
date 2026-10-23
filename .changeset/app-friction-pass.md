---
"@groot/web": patch
---

Friction pass across the app:

- Phones open the sidebar drawer from every page's menu button; detail pages
  go back to their list instead of to Chats, and the bot list reads "Chats".
- Tasks: a task added on Today stays on Today (it used to land in Upcoming),
  due dates read "Today" / "Tomorrow" instead of "11:59 PM", and completing a
  task offers Undo.
- Routines: a new routine starts daily on your most recent bot, the name is
  optional (it defaults to the prompt's first words), the schedule tabs no
  longer wrap over the input on phones, Run now links to the bot's chat, and
  the Upcoming list only shows once there is more than one routine.
- Skills: the instructions editor is a real editing area, bot assignment
  sits right under the details (with a hint while no bot uses the skill),
  and the description no longer repeats in the header.
- Connections hides the empty "Connected" group; Terminal hides its tab
  tools while the sandbox is down.
- Creating a bot right after sign-in no longer bounces you to another chat
  (an older bot-list response could land after the newer one).
- Bot-to-bot: a tagged bot's reply is relayed only once it finishes; it was
  relayed half-written whenever another chat went idle first.
