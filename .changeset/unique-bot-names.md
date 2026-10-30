---
"@groot/web": patch
---

Bot names are unique, and an @mention reaches the bot you picked (issue #80).

- Creating or renaming a bot to a name another bot already has is refused with 409 `A bot named "Echo" already exists`. Names compare without case and surrounding spaces, so `"  echo "` counts as `Echo`; a bot can still change the case of its own name. The bot dialog shows the message under the Name field.
- A mention picked from the @ list goes to that bot, even when older data has two bots with the same name. A typed `@Name` still matches by name; if several bots have that name, the message is held and the composer asks you to pick one from the list.
