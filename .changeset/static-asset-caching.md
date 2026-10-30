---
"@groot/web": patch
---

Production now caches the app's fingerprinted files (`/assets/*`) for a year
instead of downloading every script and stylesheet again on each visit, and a
request for a build file that does not exist gets a 404 instead of the app's
HTML with a 200. That HTML used to break tabs left open across a deploy (an
old chunk came back as HTML), could be cached by the CDN under the asset's
URL, and hid build problems such as the missing font. A tab that still fails
to load a chunk after a deploy now reloads itself once to pick up the new
build.
