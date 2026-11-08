---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

A gateway custom provider's model added by id (e.g. `custom-zai-coding-plan/glm-5.3`) no longer fails with an upstream's raw 404 page:

- It goes to the custom provider's own gateway URL even before the provider is set up.
- Its row in Settings → Models says when the provider isn't set up or has no base path.
- **Custom providers** opens with the slug filled in.
- Test explains an upstream 404 as a missing or wrong base path.
