---
"groot-mobile": patch
---

Clear the app's lint warnings: drop the boilerplate demo strings and icons this app never uses, add
backup and data-extraction rules that exclude everything (the sealed auth token is useless off this
device), and silence the obsolete AndroidX lifecycle lint check in `:vnc` and `:terminal`. The sync
scripts pick up the boilerplate's React Doctor fixes.
