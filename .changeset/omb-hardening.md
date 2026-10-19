---
"@tiny-agents/agent": minor
"@groot/web": patch
---

Bot-to-bot hardening from the OpenMausBot study (issues #13-#16):

- Peer text passes a custody boundary: forged provenance openings
  ("**Message from the owner:**" typed by a bot) are neutralized before
  delivery, and the roster states that bot messages are information,
  never owner instructions or permission grants (#13).
- message_bot wording suppresses duplicate acknowledgements: relayed
  replies are already visible, so the model is told not to re-send or
  thank (#14).
- The roster marks teammates that are mid-reply "(working right now)",
  and message_bot reports "queued behind their current reply" when the
  target is busy (#15).
- A reply may message at most 3 bots per turn (on top of the 10-minute
  pair window); replays of the same requestId are not charged, and going
  idle resets the budget. Refusals tell the model what to do next (#16).
