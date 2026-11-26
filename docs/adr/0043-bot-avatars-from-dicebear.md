# ADR 0043: Bot avatars load from DiceBear

- Status: **accepted**
- Date: 2026-11-26

## Context

Bot avatars are DiceBear `gaze` illustrations seeded by the bot's name, so
each avatar request sends that name to `api.dicebear.com`. An audit commit
replaced them on web with local initials circles to keep names on the
instance. Android kept DiceBear, and the owner preferred the illustrations.

## Decision

- **Avatars load from DiceBear** on web (`BotAvatar.tsx`) and Android
  (`AvatarStore.kt`), seeded by the bot's name.
- **The owner accepts the risk** that bot names reach DiceBear. A privacy or
  security audit does not replace these avatars without asking the owner.

## Consequences

- An instance with no outbound network shows empty avatar circles.
- Renaming a bot changes its avatar.
