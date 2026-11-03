---
"@groot/ui": minor
"@groot/web": minor
---

Adopt Fluid Functionalism components. `Dialog` and `AlertDialog` now spring in
and animate out (staying mounted through the exit) with a deeper dark-mode
overlay; `DialogContent` gains `size` (`sm` 400px default, `md`, `lg`, `xl`)
and `position` (`center` / `top`) props, and `CommandDialog` anchors to the
top. In the app, a bot's questions use the Fluid AskUserQuestions card
(single-choice questions answer on a click or number key) and the typing dots
are replaced by the ThinkingIndicator.
