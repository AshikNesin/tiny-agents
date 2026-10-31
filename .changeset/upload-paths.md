---
"@groot/core": minor
---

`createApp({ uploadPaths })` lets multipart endpoints that enforce their own size caps skip the JSON body limit (1 MB by default) on `/api/*`. Previously only groot's storage upload was exempt, so an app's own upload endpoint (a feedback form with screenshots and recordings, say) was cut off at 1 MB.

Exact paths or a `prefix*` (`uploadPaths: ["/api/v1/feedback"]`). The storage upload stays exempt; unset, nothing changes.
