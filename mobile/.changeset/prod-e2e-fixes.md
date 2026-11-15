---
"groot-mobile": patch
---

Fixes found testing against a real server. A message sent with a file no longer shows the server's notes for the
model (`[file attached: …]`, the fenced file text and the tool hint) in its bubble, as the web app already hid
them. Switching bots no longer leaves the previous bot's face in the top bar. Home refreshes the bot list when the
app comes back to the foreground, so bots created or pinned in the web app show up.
