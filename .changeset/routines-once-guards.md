---
"@groot/web": patch
---

Routines: a one-time routine can no longer be set for a time that has passed.
The form says "Pick a time in the future" and blocks Create (the date picker
starts at now), and the API refuses it too, including for routines bots create.
A one-time routine that has run now reads "Done" instead of "Paused", and its
toggle can't re-arm it: re-enabling it used to leave it "enabled" with a past
"Next run" at the top of Upcoming, never firing. Edit it to pick a new time.
The preview lists a one-time routine's single run instead of the same time
three times, and a late run says "late by 3h 12m" or "late by 2 days" instead
of a raw minute count.
