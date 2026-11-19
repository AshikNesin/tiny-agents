---
"tiny-agents": patch
---

Code: a coding hand-off's result now goes back to the conversation that asked for it. A routine run's hand-off reports into that run's conversation (on its budget) instead of waking the bot's chat with its whole history, and a hand-off a bot started while answering another bot is answered there, with the answer relayed back to the bot that asked. A follow-up's result goes to the conversation that sent it. Hand-off threads also get a short title, like threads you start.
