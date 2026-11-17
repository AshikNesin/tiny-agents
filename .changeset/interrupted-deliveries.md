---
"tiny-agents": patch
---

A bot-to-bot message or @mention whose reply a server restart cut off is no longer left waiting forever. On the next boot it is closed, and the bot that asked is told "(couldn't answer: interrupted by a server restart)", the same way it hears about a failed reply. Messages sent more than a day ago close quietly, so old stuck ones do not wake every bot at once. Deliveries and routine runs now share one module for answering and boot recovery (`bots.awaited.ts`).
