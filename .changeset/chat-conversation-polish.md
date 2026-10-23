---
"@groot/web": patch
---

Polish the bot conversation UI. The composer now shows one action button
(Stop while a reply runs with nothing typed, Send/Steer otherwise) instead
of Stop and Send side by side, Esc stops a reply, and the composer keeps
focus after sending. Streaming replies follow the bottom of the transcript
again instead of snapping back to an older read message. Opening a chat no
longer flashes the empty state or a "Reconnecting…" banner before the first
snapshot, and replies to messages sent while the chat is open are no longer
flagged "New messages". Also: a typing indicator while the bot works with
nothing to show yet, a reasoning block that collapses when done, per-bot
unsent drafts, drag-and-drop attachments, a reconnecting notice that
actually appears when the stream drops, and the FeedbackBee launcher no
longer covers the send button on phones. The composer moved out of
ChatPane into its own ChatComposer component.
