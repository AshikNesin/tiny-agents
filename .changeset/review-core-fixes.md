---
"@groot/core": patch
---

Fixes from the 404less onboarding review:

- `renameFile` onto its own path no longer deletes the file (it 404s for a missing source, otherwise no-ops).
- Only the multipart upload route skips the global JSON body limit; the other storage routes keep it.
- Downloads of HTML/SVG/XML/JS are served as attachments, and every download sends `X-Content-Type-Options: nosniff`, so an uploaded file cannot run script on the app origin.
- Uploaded file names containing `/` are rejected.
- `getContentType` no longer resolves `Object.prototype` members (`report.constructor`).
- `listKeys` rejects limits below 1 instead of returning a silently truncated page.
- The kv store's prefix match is case-sensitive (`clear("user:")` no longer deletes `User:1`).
- `parseForm` answers a malformed form body with 400 instead of 500; `verifyPassword` returns `false` for malformed stored hashes instead of throwing.
- Passkey names are trimmed, so whitespace-only names are rejected.
- Local (Node) storage writes through a temp file and renames it over the target, so an interrupted overwrite keeps the previous object.
