---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

A tool call waiting on you (an approval card, questions, a sign-in or code sheet) now parks instead of holding a process wait: your answer wakes it through a durable signal, and an expiring card wakes at its deadline. After a restart the waiting counts, badges and pushes are right at once, without re-running the waiting calls.
