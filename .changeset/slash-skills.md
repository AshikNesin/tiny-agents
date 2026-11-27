---
"@tiny-agents/agent": minor
"@tiny-agents/code": minor
"tiny-agents": minor
---

Typing `/` at the start of a message lists your skills: in a bot chat (the bot's skills) and in a Code thread whose agent takes skills (Native and Shelley). In a chat the pick is written as `/skill-name ...`, and the bot is told that such a message asks for that skill. In a Code thread the pick joins the message's skills like the **+** menu. Native threads now list skills too, the shared ones plus the repo's `.agents/skills` and `.claude/skills`, and a Native agent reads a repo skill's `SKILL.md` when asked for it by name.
