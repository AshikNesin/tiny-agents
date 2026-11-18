---
"tiny-agents": patch
---

Credential requests now fill sign-ins split over pages, like amazon.in's: the email is filled and submitted, then the password is filled on the next page. Amazon's email field (`autocomplete="webauthn"`) is now recognised, and a bot is told which fields the page never showed.
