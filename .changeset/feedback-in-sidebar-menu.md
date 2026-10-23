---
"@groot/web": patch
---

Move feedback into the sidebar's account menu: "Send feedback" opens the
FeedbackBee panel beside the menu, and the floating launcher is hidden
wherever the sidebar is shown (signed-out pages keep it). E2E logins now
target the login form's Email field exactly, since FeedbackBee adds an
"Email (optional)" field to every page.
