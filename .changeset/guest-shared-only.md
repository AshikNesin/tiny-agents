---
"tiny-agents": patch
---

A guest now sees only what the owner shared with them.

- Uploads: a guest reads an upload they uploaded, or one sent in the chat of
  a bot shared with them, and deletes only their own. Any other upload id
  answers 404, as an unknown one does. A guest cannot send an upload they
  cannot read. Uploads record who uploaded them and the bot whose chat they
  were first sent in (migration `0007`). An upload sent before this change
  has neither, so only the owner reads it.
- `GUEST_ACCESS` gains an `upload` rule kind (matched after `/uploads/<id>`,
  with the uploads it reaches), so the guest guard checks the upload the way
  it checks a shared bot. The drift test refuses a plain `path` rule that
  matches an upload's routes.
- `/events` sends a guest the activity (replying, approvals, questions) of
  the bots shared with them only, and no connection state. The owner's feed
  is unchanged.
