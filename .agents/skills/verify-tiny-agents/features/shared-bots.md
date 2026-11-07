# Shared bots and guests

The owner adds guests (accounts they hand a password to) and shares individual bots with them. A shared bot's chat is one live conversation: owner and guest see every message and reply, each labeled with who sent it. A guest sees only the bots shared with them and none of the owner's pages or controls; unsharing hides the bot again and removing the guest deletes their account.

## Sub-features

- `share-add-guest` Settings → `People` → card `Add a guest` (`Name`, `Email`, `Password`) → `Add guest`; toast `Guest added`; `data-testid=guest-row` reads `No bots shared` / `Shared: <bots>`.
- `share-toggle` `Edit <bot>` → tab `Sharing` → switch `Share with <guest name>` → `Save changes`; the header shows `Shared`.
- `share-guest-view` guest sidebar lists only shared bots, no `New bot`, no row actions, no Tasks/Terminal/Computer/Browser; chat header has the bot name (disabled), no YOLO toggle, no New chat.
- `share-live-chat` the guest sees the existing history; each side sees the other's messages labeled with the sender's name, live, and the bot's replies.
- `share-guards` owner pages (`/tasks`, `/memory`, `/routines`) redirect a guest to `/chats`; guest Settings shows only theme and sign-in; the API answers 403 for owner routes and 404 for unshared bots.
- `share-unshare` switching sharing off removes the bot from the guest (`Nothing shared with you yet.`).
- `share-remove-guest` `Remove <guest>` → alert dialog `Remove <guest>?` → `Remove`: row gone, the guest can no longer sign in, and their open session is signed out.

## How to get to it (user POV)

- Owner: account menu → Settings → tab `People`; a bot's `Edit <bot>` → `Sharing`.
- Guest: sign in at `/login` with the email and password the owner chose; the shared bot is in the `Bots` sidebar region.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, owner signed in in `page`. Two faux bots `Shared Bot <stamp>` and `Private Bot <stamp>` (API setup).
- The guest uses a second browser context (`page.context().browser().newContext({ baseURL })`); its login is a second sign-in against the rate limit.

- **Add guest.** People tab: fill `Name` / `Email` / `Password` (exact names), `Add guest` → toast, row `No bots shared`; `GET /people` lists them.
- **Share.** Sharing tab switch → `Save changes` → `Shared` in the header; `GET /bots/:id` `guestIds: [guestId]`; People row `Shared: <bot>`.
- **Owner message.** Send `owner hello <stamp>` → `Echo: Demo User: owner hello <stamp>`.
- **Guest.** Sign in; sidebar has only the shared bot; open it: the owner's message is labeled `Demo User` (`[data-author="Demo User"]`); no owner controls.
- **Live.** Guest sends `guest hello <stamp>` → the owner's page shows it under `[data-author="Guest <stamp>"]` without a reload; both see `Echo: Guest <stamp>: guest hello <stamp>`.
- **Guards.** Guest `/tasks`, `/memory`, `/routines` → `/chats`; `/settings` shows `Your theme and sign-in.` and no `People` tab; guest API `GET /tasks` 403, `GET /people` 403, `PATCH /bots/<shared>` 403, `GET /bots/<private>` 404, `GET /bots/<shared>` 200.
- **Unshare / remove.** Owner switches sharing off → guest `/chats` shows `Nothing shared with you yet.`, `GET /bots/<shared>` 404. Owner removes the guest → row gone; guest `POST /auth/login` 401; the guest's open session lands on `/login` from `/vault` and `/settings`, and its `GET /people` and `GET /vault` answer 401.
- **Proof.** `ta-verify drive $S/journeys/shared-bots.mjs` → owner `guest-added`, `owner-shared-chat`, `owner-sees-guest`, `guest-removed`; guest `guest-view`, `guest-chat`, `guest-unshared`, `guest-signed-out`.

## Gotchas

- Create guests through `People` (or `POST /people`). An account from `POST /api/v1/auth/users` has no `guests` row, so it is a second **owner**, not a guest, and never appears in the Sharing tab.
- The FeedbackBee embed adds an `Email (optional)` field: use `getByRole("textbox", { name: "Email", exact: true })`. The embed loads from a third-party host and can hold the `load` event for 30 s+; navigate the guest with `waitUntil: "domcontentloaded"`.
- The bot reads shared-chat messages as `Name: message`, so the faux echo is `Echo: <Name>: <message>`. Anchor echo regexes (`^Echo: …$`): unanchored, they match the whole transcript before the reply exists.
- `Code` is the guest's one page but is hidden without a coding agent (`SHELLEY_URL` / Claude plan), so it is not in a verify run's sidebar.
- Not reachable on the faux model: `[skip]` replies hidden in shared chats, vault approvals only the owner can give, memory being off while shared (capture is disabled in faux mode anyway).
