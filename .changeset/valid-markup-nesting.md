---
"@groot/web": patch
---

Fix invalid HTML that made React log DOM-nesting errors: the breadcrumbs on the
skill, connection and connection-tool pages put a separator `<li>` inside a
breadcrumb `<li>`, and a chat reply with text next to an image put the image
wrapper `<div>` inside a `<p>`.
