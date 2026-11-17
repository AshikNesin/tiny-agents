---
"tiny-agents": minor
"@tiny-agents/agent": patch
---

Two more cost guards. One reply may now make at most 150 tool calls, through all its tool rounds: past that the Tool gate refuses calls so the model wraps up, and a reply that keeps calling 20 more is stopped (the Claude plan keeps its own `maxTurns`). And a message one bot sends another (`message_bot`) now runs in a fresh conversation of the target's own, unattended and with a routine run's 500k-token budget, instead of in the target's chat with its whole history: answering no longer re-sends that history, and a routine that messages a bot can no longer escape its own budget that way. The reply is still relayed into the sender's chat; the target's chat no longer shows the exchange, and the target answers from the message alone. Owner @mentions still go to the target's chat. `bot_messages.own_conversation` marks these conversations.
