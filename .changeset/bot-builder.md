---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Bots can create a new bot when the owner asks (issue #149): `create_bot` in the
new `bot-builder` capability takes a name, a description, instructions and an
optional model (the creating bot's by default). It always waits for the
owner's approval, and is refused in routine runs, in turns started by another
bot and in chats shared with guests.
