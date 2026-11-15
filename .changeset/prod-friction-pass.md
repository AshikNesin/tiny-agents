---
"tiny-agents": patch
---

Fixes from an end-to-end pass on a live install.

- **Connections signed in before the new secret format work again.** An OAuth connection whose saved sign-in was stored in the old `v1` format (or under another `SECRETS_KEY`) showed "The stored secret is in an unknown format." with only Reconnect, which failed the same way, and signing in failed on it too. It now asks you to sign in again, and signing in replaces the old value.
- **Routines show a run's result without a reload.** After Run now, Recent runs said "awaiting" until the page was reloaded; it now checks back while a run is in flight.
- **Tasks say where quick-add put a task.** A task typed on Today with another day ("tomorrow 5pm") used to vanish from view; a toast now says it went to Upcoming, with Show.
- **The Vault names the model provider that used a key** ("used … by Cloudflare AI Gateway") instead of its id.
- **Settings → Models** says when an account was last checked as a relative time, and on a phone puts the account's actions under its summary instead of squeezing the summary into a narrow column.
