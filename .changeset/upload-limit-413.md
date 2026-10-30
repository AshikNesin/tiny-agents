---
"@groot/web": patch
---

Attachments: a file over 25 MB is now refused in the composer before it
uploads ("big.mp4 is 30 MB; files can be up to 25 MB."), and the server
answers 413 "Files can be up to 25 MB." instead of a 500 that was logged (and
sent to Sentry) as a server error. When an upload fails, a toast now gives the
reason, and the failed tile no longer draws "Upload failed" over the file name.
