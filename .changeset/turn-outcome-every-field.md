---
"@tiny-agents/code": patch
---

`turnOutcomeProblems` (`@tiny-agents/code/testing`) checks every
`TurnOutcome` field from one table keyed by the type, so a new field does not
compile until it has a check. It also reports an outcome that carries fields
the rule does not answer, such as a thread summary spread into it.
