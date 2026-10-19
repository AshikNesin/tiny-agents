---
"@tiny-agents/agent": patch
---

Every bot submit path (sendMessage, mention delivery, bot-to-bot relay) now reconciles the durable conversation's configuration from the bot row before submitting, and a saved `vision` toolkit is dropped when the model sees images natively. Previously a conversation kept the config from its last explicit configure, so a model that gained vision (e.g. glm-5.3-flash) left the stale see_image prompt installed and the bot fabricated attachment ids.
