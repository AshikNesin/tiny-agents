---
"tiny-agents": patch
---

A credential request filled twice while the first fill is still running now gets the first fill's answer instead of "This request is being filled already.", and the web form's button reads **Filling…** while it runs. Saving a new item to 1Password takes one request fewer: the item's details come from 1Password's create answer instead of a second read.
