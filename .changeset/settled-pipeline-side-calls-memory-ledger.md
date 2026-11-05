---
"@groot/web": patch
---

Relay @mention and bot-to-bot replies that take real model time. Boot built
the Delivery answerer before the agent runtime had opened, so every relay
from a conversation's settling (and the boot sweep) failed against an
undefined runtime; only replies that finished before the submit returned
were relayed. The answerer is now built from the opened runtime.
