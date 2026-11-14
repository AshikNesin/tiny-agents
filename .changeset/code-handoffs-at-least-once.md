---
"tiny-agents": patch
---

Code hand-offs: a bot hears every finish, once, and a start makes one thread (register row C7).

- **Finishes:** when a handed-off turn ends, its "Reply from …" is recorded as owed before it is sent. One cut off by a restart or a failed send is sent again at boot, on reconnect and every 30 seconds until it lands, and the bot's chat never shows it twice.
- **Starts:** a `code_start` that pi-durable runs again (after a restart, or while the first run is still starting) makes no second thread. A start interrupted after the harness may have made its thread is not repeated; the bot is told to check with you.
- **Follow-ups:** `code_send` arms the hand-off before the harness hears the message, so a turn that ends at once still reports back, and a thread's sends go one at a time.
- **Migration:** `0013_code_handoff_finishes` adds the `code_handoff_finishes` table and lets `code_handoffs.thread_id` be empty while a start is claimed; existing rows are copied as they are.
