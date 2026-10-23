---
"@groot/shell": minor
---

`ShellConfig.openNav` lets an app with `pageChrome: "sidebar"` open its own
navigation from every page: phones get one menu button where the back button
and profile circle were, while pages that pass the new `PageLayout` /
`TopBar` `backTo` keep a back button to their parent. On phones the page
description now sits under the title, above the action row, and on desktop
the title row has the same height with or without actions, so headers no
longer shift between pages.
