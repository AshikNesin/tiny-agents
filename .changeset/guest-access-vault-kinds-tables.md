---
"tiny-agents": patch
---

Keep guest access and vault kind defaults in one shared table each, so
adding a guest page or changing a kind's default tools is one edit.

- `apps/web/src/shared/guest-access.ts` lists each guest-visible feature
  with its page and its API routes. The guest guard, the sidebar and the
  router all read it. Every signed-in page sits under one guest gate in
  `App.tsx` that sends a guest to their chats from any page the table does
  not list. A guest sees and reaches the same pages as before.
- `apps/web/src/shared/vault-kinds.ts` holds the default tools per vault
  kind. The server and the New item page import it. The defaults are
  unchanged.
- Tests fail, naming the table, when a signed-in route sits outside the
  gate, a table page has no route, the guard admits a route the table does
  not list, or a table rule matches no mounted route.
