---
"tiny-agents": patch
"@groot/ui": patch
---

The FeedbackBee feedback widget now loads in headless mode: no floating button in the bottom-right corner on any page. "Send feedback" in the sidebar's account menu opens it as the embed's own centered modal, replacing the app's CSS that hid the launcher and restyled the panel. Hotkeys no longer treat an inert `aria-modal` element (a closed modal kept in the page, like the headless panel) as an open dialog, so ⌘K and other shortcuts keep working after the feedback panel closes.
