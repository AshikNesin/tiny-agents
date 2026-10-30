---
"@groot/web": patch
---

The Inter font loads in production again. The production build kept the
font's relative `url(./files/*.woff2)` references but never copied the files,
so browsers got the app's HTML instead of a font and fell back to the system
typeface. The font is now imported from the app entry, so the build emits the
`.woff2` files with hashed names.
