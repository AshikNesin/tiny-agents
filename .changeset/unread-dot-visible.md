---
"@groot/web": patch
---

Sidebar: the unread dot on a bot row is visible again. It was an inline
`<span>`, so its 8px size was ignored and it rendered as an empty 0×0 box.
