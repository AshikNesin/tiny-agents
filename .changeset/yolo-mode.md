---
"@tiny-agents/agent": minor
"@groot/web": minor
---

YOLO mode (issue #151): a per-chat switch in the chat header under which
every tool call that would ask the owner runs without a card, including
`askOnly` tools and cards already waiting when it is switched on. Vault uses
always keep their card, and turns another bot or a guest started still ask.
It lives in the conversation's new `tiny.yolo` document (`YoloDoc`), so a New
chat starts with it off. The agent runtime adds `yolo(ref)` and
`setYolo(ref, on, by)`; the gate records such calls as `approval: "yolo"`;
`ToolInfo` gains a `vault` flag the Claude plan engine uses to keep vault
sinks asking. The app adds `PUT /bots/:id/yolo` (owner only) and a `yolo`
event on the bot's chat stream.
