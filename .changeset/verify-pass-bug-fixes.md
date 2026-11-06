---
"@groot/web": patch
---

Fixes for bugs found by the verify-tiny-agents full pass:

- Vault: a wrong step-up password (or someone else's passkey) is refused with
  403, not 401, so the owner is no longer signed out and keeps unsaved edits
  (#164).
- Chat attachments: the enlarged image viewer is portalled to the page, so it
  covers the window instead of being clipped to its message row (#165).
- ⌘K palette: the app's own Navigation, Theme and Account groups are no longer
  listed a second time by the shell, and Code no longer shows when no coding
  agent is configured (#166).
- Chat composer: "+ → Mention a bot" leaves focus in the composer, so the
  mention list opens (#167).
- Jobs: `/jobs/:jobId` is mounted, so job rows and the Add Job / Re-run toast
  links open the job instead of falling through to the chats (#169).
- Terminal: in full screen, the exit control sits inside the terminal region,
  so the CSS full screen used where the Fullscreen API is missing (iPhone
  Safari) can be left again (#170).
- Settings → Claude plan: with the engine off, the card no longer claims that
  no sandbox is configured (#171).
