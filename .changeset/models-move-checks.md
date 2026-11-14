---
"tiny-agents": patch
---

Settings → Models: deleting a model or account in use moves its users only where they could have been set (register row C12).

- **Classifier role:** it moves only to another classifier model, never onto a chat model. An account whose classifier and chat models are both in use asks you to move the classifier role first.
- **Claude plan fallback:** it moves only to a chat model that runs on pi, never to a Claude plan model, the same rule as picking the fallback on the Claude plan's card.
- A refused move answers 400 with the reason and changes nothing.
