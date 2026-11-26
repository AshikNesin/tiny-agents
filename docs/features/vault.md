# Vault (logins, cards, one-time codes and API keys)

Bots use the owner's secrets **without the model ever seeing them** (issue
#56). The model only knows opaque **handles** (`github`, `amex`, `openai`).
A value is resolved at the tool boundary, in the server process, at use
time, and goes straight into one sink: a browser field (over CDP), an HTTP
header on a request the server makes, or an MCP connection header. Values live
in **1Password** (read through service accounts with 1Password's SDK) or in
the `local` backend, sealed with `SECRETS_KEY`; the item rows
hold references and policy only. Both sit behind one `VaultBackend` port
(`apps/web/src/server/api/vault/backends/types.ts`).

Code: `packages/agent/src/vault.ts` (the port), `packages/agent/src/redact.ts`,
`packages/agent/src/toolkits/{vault,browser,web}.ts`,
`packages/sandbox/src/browser-fill.ts` (the browser sink) and
`packages/sandbox/src/vault-target.ts` (`SecretValue`), and
`apps/web/src/server/api/vault/`. UI: `apps/web/src/client/pages/vault/`.
Decision records: [ADR 0005](../adr/0005-secrets-live-outside-the-app.md),
amended by [ADR 0017](../adr/0017-local-is-the-only-vault-backend.md),
[ADR 0019](../adr/0019-vault-values-table.md),
[ADR 0027](../adr/0027-1password-connect-runs-inside-the-app.md) and
[ADR 0045](../adr/0045-1password-through-service-accounts.md).

## How a use flows

```
model ── handle ──▶ sink tool ── gate (tool permission + item policy + approval) ──▶ VaultBroker.use
                                                                                       │
                                                                                       ▼
                       redactor ◀── value ── backend (1Password | local) ──▶ sink (page / header)
```

1. **Discover.** `vault_list` returns handles and metadata (label, kind,
   username, origins/hosts, card brand and last 4, "when to use"). Never a
   value, a backend id or a token.
2. **Plan.** Before anything runs, the gate asks the broker for the item's
   policy decision: unknown handle, disabled, wrong tool, wrong origin or
   host, unattended, or vault locked refuse the call outright (audited, no
   approval card). Otherwise it says whether the owner must approve.
3. **Approve.** One card in the chat shows the bot, the item (cards: brand
   ••last 4), the tool and the **target** (origin or host), with **Deny**,
   **Approve once** and — except for cards and every-use items — **For this
   chat** (a `vault:<handle>` grant kept in the conversation's
   `tiny.grants` document; a new chat starts without grants). Vault approvals
   **expire after 10 minutes** and the call fails closed. A Pushover
   notification goes out for every vault approval.
4. **Use.** The broker re-checks policy, resolves only the fields needed,
   registers every value with the redactor, hands them to the sink and
   audits the outcome. The tool result says which fields were filled, never
   what.

Every attempted use — refusals, denials and expiries included — writes a
`VaultAuditEvent` (no values, ever). The Vault page shows each item's trail
and "last used … by …".

## Tools

| Tool                  | Toolkit   | Default | What it does                                                                                                                                                                                                                                                                                        |
| --------------------- | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_list`          | `vault`   | allow   | Handles + metadata the bot may use, optionally by tool or origin.                                                                                                                                                                                                                                   |
| `browser_fill_secret` | `browser` | ask     | `{handle, field?, ref?}`: a login's password (or username) or a card's number, expiry, security code and name, on the item's exact origin. The origin is checked when planning, again before resolving, and once more inside the page before the write.                                             |
| `browser_enter_code`  | `browser` | ask     | 2FA: with a handle whose item has a TOTP seed, the server computes the code (RFC 6238) and fills it; otherwise it opens a credential request for one code.                                                                                                                                          |
| `request_credentials` | `browser` | allow   | Opens a credential request sheet (below). The owner's submit is the consent.                                                                                                                                                                                                                        |
| `http_request`        | `web`     | ask     | A request the server makes itself (never through TinyFish), with `auth: <handle>` added as a header only for the item's allowed hosts. Private addresses (also after DNS) are refused, and the request connects only to the addresses checked; the header is dropped on a redirect to another host. |
| `run_command`         | `sandbox` | ask     | With `secrets: [{handle, env}]`: each value is set as an env var for that one command. Every such call asks (full command on the card), and the command runs confined to the items' hosts (below).                                                                                                  |

A chat's [YOLO mode](./yolo-mode.md) never covers a vault use: a call that
carries a vault item always shows its card, and the broker still requires the
owner's approval before it resolves a value.

An MCP connection's header value is a vault item: its own (`mcp-<slug>`,
written when the owner enters the value on the connection, no bots, tool
`mcp`), or one the owner picks (`Connection.secretRef`, set with
`PATCH /connections/:id { secretRef }`). It is resolved at connect time,
audited, and needs the item to allow `mcp`. See
[connections](./connections.md#stored-secrets).

Tool text tells the model: _"Never type, ask for or repeat a password, card
number, security code or one-time code yourself."_ `browser_type` points to
`browser_fill_secret` and `request_credentials`.

## Policy

Per item, set in the Vault UI:

| Setting         | Meaning                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| Handle          | The only name bots see; lowercase slug.                                                   |
| Fills only on   | Exact `scheme://host[:port]` origins (logins, cards). Subdomains never match implicitly.  |
| Sent only to    | Exact hostnames (API keys), plus the header name and format (`Bearer {value}`).           |
| Approval        | `every_use`, `per_conversation` (default) or `allowed`. **Cards are always `every_use`.** |
| Use in routines | Off by default: routine runs and messages from other bots are refused. **Cards: never.**  |
| Bots            | Every bot, or a list.                                                                     |
| Tools           | Empty means the kind's default (below).                                                   |
| When to use     | A hint shown to the bot.                                                                  |
| On / off        | A kill switch per item.                                                                   |

| Kind     | Default tools                               |
| -------- | ------------------------------------------- |
| login    | `browser_fill_secret`, `browser_enter_code` |
| card     | `browser_fill_secret`                       |
| identity | none (owner reference only in v1)           |
| api_key  | `http_request`, `mcp`                       |

A turn counts as **unattended** when it runs in a routine's own conversation
(every routine run, see [routines](./routines.md)) or when the chat's latest
user message is a delivery from another bot. When in doubt it counts as
unattended, which only ever refuses more.

## Audiences

Every item has an audience (ADR 0015):

- `bots` (the default): listed to bots and used through their tools, under
  the policy and approvals above.
- `app`: a secret the server uses itself, such as a model provider's key. It
  is never listed to bots, and a bot's tool that names it is told there is no
  such item. Only the `provider` sink resolves it, for a host the item lists,
  with no approval. Refusals and failures are audited; successful uses only
  update "last used", and the value is cached in memory for up to five
  minutes. The Vault page lists these items under "Used by the app" and
  refuses edits and deletes there with 409: they change where they are used.

## Sandbox commands and the egress allowlist

`run_command` can hand a command vault values as env vars:
`secrets: [{handle: "github", env: "GITHUB_TOKEN"}]` (up to 4). This is the
one sink where model-written code holds the secret, so it is the strictest:

- The item must list `run_command` in its tools (no kind has it by default)
  and name the hosts the key may reach (**Sent only to**).
- **Every call asks**, whatever the item's approval setting, and the card
  shows the full command, the env vars and the hosts it may reach. Grants
  don't apply; unattended runs are refused unless the item allows them.
- A command that names a URL host outside those hosts is refused before
  anyone is asked (a heuristic; the confinement below is the real control).
- Values travel over the SSH channel's **stdin**, one line each, and are read
  into the env vars inside the command's shell — never argv, a file or ssh
  `AcceptEnv`. Multi-line values and detached commands are refused, and env
  names like `PATH` or `LD_PRELOAD` are not allowed.
- The command runs **confined**: in a transient systemd unit (`sudo
  systemd-run`) with `NoNewPrivileges=yes` (so sudo no longer works inside
  it), `IPAddressDeny=any` plus `IPAddressAllow=` the allowed hosts' current
  addresses (no loopback, so no Chrome DevTools port; no tailnet), no unix sockets, and a read-only `/etc/hosts` holding only
  the allowed names, so there is no DNS to tunnel through. Output is scrubbed
  like every tool result.

**Egress allowlist.** `SANDBOX_EGRESS_ALLOWLIST` (hostnames, IPs or CIDRs,
comma-separated) confines **every** `run_command` the same way; commands with
secrets may reach their items' hosts plus this list. Unset, only commands with
secrets are confined. The browser and the terminal are not affected.

Confinement needs **systemd and passwordless sudo** on the VM (the browser
setup already needs sudo). When either is missing, a confined command fails
with a clear message and never runs unconfined. Host addresses are resolved
on the VM just before each run.

Residual risk, accepted: the approved command can still write the value
somewhere a later, unconfined command reads it. That is why every use shows
the full command. Read it before approving.

## Credential requests

When no item exists (or a code arrives by SMS or email), the bot calls
`request_credentials({title, purpose, fields})`. The server binds the request
to the page's **current top-level origin** (https only, except hosts in
`BROWSER_ALLOWED_PRIVATE_HOSTS`), validates the form (1–8 fields, slug keys,
short labels; text, email and select fields need an identifier `autocomplete`
such as `username`, `email` or `postal-code` — no free text, so the form
can't become a side channel), and waits like an approval. One request may be
open per chat, three per chat per hour, each for 10 minutes.

The chat shows the form right in its card (the request's link,
`/vault/requests/:taskId`, opens that chat on it): the **origin**, the bot's
purpose, masked inputs with `autocomplete` (so the owner's own password
manager can fill them), a **Securely save to vault** switch, **Continue** and
**Cancel**. What the owner types goes to the submit route, never into the
chat. On submit the server re-checks the page's origin, fills over CDP
(submitting a sign-in's email step to reach its password step), optionally
saves a login
or card (**never a one-time code or a security code** — and a save needs the
step-up token the other vault writes ask for), audits the keys
filled and resumes the bot with `{status, filled_fields, saved_item_handle?}`.
Typed values exist only in that request's memory.

## Vault UI and routes

`/vault` lists items by kind (Logins, Cards, Contacts, API keys), backend
items not linked yet, and the backend's status. Items can be created
(login, card, contact, API key), linked, edited, revealed, copied and
deleted.

Writes, reveals and copies need **step-up**: the owner re-enters their
password (or uses a passkey) and gets a token valid for 5 minutes, held in
page memory only and sent as `X-Vault-Step-Up` (which also makes these routes
CSRF-proof). Revealed values hide after 30 seconds; copied ones are cleared
from the clipboard after 30 seconds (best effort). Delete and reveal send a
Pushover alert. Every response is `Cache-Control: no-store`, request bodies
are never logged, and Sentry drops the bodies of vault requests.

| Method & path                                | Step-up | Does                                                   |
| -------------------------------------------- | ------- | ------------------------------------------------------ |
| `GET /api/v1/vault[?refresh=1]`              | —       | Backends, items (metadata + policy), unlinked items    |
| `GET /api/v1/vault/items/:handle`            | —       | Item, which fields hold a value, audit trail           |
| `POST /api/v1/vault/step-up[/options]`       | —       | `{password}` or `{passkey}` → `{token, expiresAt}`     |
| `POST /api/v1/vault/items`                   | yes     | Create in the primary backend + policy row             |
| `POST /api/v1/vault/links`                   | yes     | Link an existing backend item                          |
| `PUT /api/v1/vault/items/:handle`            | yes     | Update title, urls, values and/or policy               |
| `PATCH /api/v1/vault/items/:handle`          | yes     | `{field, value}`: change one value (rotate a password) |
| `DELETE /api/v1/vault/items/:handle`         | yes     | Unlink; `?purge=true` deletes it in the backend too    |
| `POST /api/v1/vault/items/:handle/reveal`    | yes     | `{field, purpose: reveal \| copy}` → one value         |
| `GET /api/v1/vault/requests/:taskId`         | —       | A pending credential request (metadata)                |
| `POST /api/v1/vault/requests/:taskId/submit` | on save | `{values, save}`: fill, optionally save, resume        |
| `POST /api/v1/vault/requests/:taskId/cancel` | —       | Cancel the request                                     |

## Redaction

`secretRedactor` (in `@tiny-agents/agent`) keeps every value resolved in the
process for 24 hours after its last use, with its base64, base64url,
URL-encoded and JSON-escaped forms, and card numbers with or without
separators (values shorter than 4 characters are not scrubbed). The approval
gate scrubs every tool result (snapshots, API responses, MCP results), the
transcript view scrubs again, and the app registers the redactor as the
logger's and Sentry's scrubber (`@groot/core/logger` `setScrubber`), which
also masks fields named `password`, `secret`, `cvc`, `cardNumber`, `totp`,
`otp` and `authorization`. Redaction is the backstop; the main control is that
no code path hands a value to anything but a sink.

## Backends

### 1Password

The backend reaches 1Password through **service accounts** with the official
JavaScript SDK (`@1password/sdk`): items are decrypted in the app's process,
so 1Password stays zero-knowledge, and each service account is limited to the
vaults and permissions it was created with. Code:
`apps/web/src/server/api/vault/backends/onepassword.ts` (the SDK client and
scoping guard) and `onepassword-mapping.ts` (kinds ↔ categories and fields).

1. In 1Password, create a vault named **tiny-agents** holding only the items
   bots may use (plus one-time password fields where a bot should do 2FA).
   Service accounts can't use the built-in Personal, Private or Employee
   vaults, so it must be a vault of its own.
2. On 1Password.com → Developer → **Service accounts**, create two, each with
   access to **only** that vault. A service account's vaults and permissions
   are fixed when it is created:
   - `OP_SERVICE_ACCOUNT_TOKEN`: **read** only (bots resolve with it);
   - `OP_SERVICE_ACCOUNT_ADMIN_TOKEN`: **read and write** (only the Vault
     page's routes load it). Without it 1Password items are read-only in the
     Vault page and new items stay local. With only this token, bots use it
     too; a separate read-only token keeps bots off write access.
3. Set the token(s) on the app and redeploy.
4. Open **Vault**: the 1Password card says **Ready · Vault "tiny-agents"**.
   New items go to 1Password; items made in 1Password show under "Not linked
   yet" to link.

`OP_VAULT_ID` is optional: without it the vault is the one the token sees.
Without either token there is no 1Password card.

**Where new items go.** With `OP_SERVICE_ACCOUNT_ADMIN_TOKEN` set, every new
item from the Vault page goes to the 1Password vault (the pinned one), and so
does a new key the app uses itself (a model provider's key, the GitHub App's
private key and webhook secret). MCP connection secrets stay local. A refused
write names the step and 1Password's own message.

**Moving local items.** The 1Password card shows **Move N local items here**
when items live in the local vault, the app's own keys included. After step-up it copies each one
(values, URLs, OTP seed) into 1Password, points the item at the copy, and
deletes the local value (`POST /vault/move-to-1password`). An item that fails
stays local and the toast says why. MCP connection secrets are not moved.

**No offline copy.** Every use asks 1Password's servers; nothing is cached
on disk. When 1Password is unreachable, vault uses fail closed and the rest of
the app keeps working.

**The app's keys in 1Password.** Bots still can't use them: the vault refuses an
`app` item to every bot whatever backend holds it. The server keeps each value
it read for 5 minutes. When 1Password fails, it serves the last value it read;
with none yet it retries for about 8 seconds, inside GitHub's 10-second
webhook timeout, before the call fails.

**Scoping guard.** The backend lists the token's vaults before its first use
and at least every 6 hours after (the Vault page re-checks when it loads).
Unless the list is **exactly** the pinned vault, it reports
`token_overscoped`, names the extra vaults, and refuses every use; the app
still boots. Every call names the pinned vault, and an item whose vault
differs is refused.

**Rate limits.** 1Password limits each service account token per hour (reads
and writes counted apart) and each account per day, by plan; see 1Password's
service account rate limits page. A value is read once per approved use, so
normal use stays far below them. A request over the limit fails that use with
1Password's message.

**Rotation.** Values: change them in 1Password (or the Vault page); the next
use picks them up. Tokens: create a new service account with the same vault
access, update the env var, redeploy, then delete the old one.

#### Field mapping

| Kind     | Category         | Fields                                                                                             |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| login    | `Login`          | `username`, `password`, a `Totp` field (in a `tiny-agents` section when the app adds it), websites |
| card     | `CreditCard`     | `ccnum`, `expiry` (`MonthYear`, `MM/YYYY`), `cvv`, `cardholder`, `type` (read only)                |
| identity | `Identity`       | `firstname`, `email`, `defphone`, `address` (an `Address` field is read from its parts)            |
| api_key  | `ApiCredentials` | `credential`, `username`                                                                           |

Notes are the item's own notes. The SDK doesn't document the built-in field
ids of every category; the mapping uses 1Password's template ids with a title
fallback, pinned in `tests/server/api/vault/vault-units.test.ts`. Websites are
saved on logins only (the SDK keeps them for `Login` and `Password` items).
Edits keep fields the mapping doesn't model (read-modify-write of the whole
item through `items.put`). A 1Password item's policy lives on its row only,
unlike a local item's (ADR 0015).

### Local

Without a writable 1Password, items go to the `local` backend (`apps/web/src/server/api/vault/backends/local.ts`):
one `vault_values` row per item, sealed by
`apps/web/src/server/crypto/secret-box.ts`. It's fully writable from the Vault
UI.

- **Rows.** `vault_values` holds `id` (the `externalId` a `vault_items` row
  links), `sealed` (the item's title, urls and values as one ciphertext),
  `policy` (the policy digest it is sealed under) and timestamps. Every write
  is one statement or one synchronous transaction (create, a value edit, a
  re-seal with its row write), so concurrent writes never lose one another,
  and there is no index to keep (C11).
- **Keys.** Each purpose (`vault-local`, `connection`) gets its own AES-256-GCM
  key, derived from `SECRETS_KEY` with HKDF-SHA256. Every write uses a fresh
  IV. Values are stored as `v2:<kid>:<iv>:<tag>:<ciphertext>`, where `kid`
  fingerprints the key. `SECRETS_KEY` must hold at least 32 bytes of key
  material (counted after base64 or hex decoding) to seal; a shorter one keeps
  reading what it sealed before the floor, but new writes are refused with the
  reason, and `pnpm secrets:rotate` moves to a longer one.
- **Binding.** The purpose, the record (the item's id, or the connection row)
  and the field are the AAD. A value copied to another item, row or column
  does not decrypt. A local item's AAD also carries the digest of its policy
  (audience, origins, hosts, injection; `vault.policy.ts`).
- **Authority (S11).** Every read (the listing, describe, resolve, reveal and
  the item page) opens an item under the digest of the `vault_items` row that
  links it, and the stored `policy` must equal it. Only an item no row links
  opens under its stored digest, and the AAD makes that one tamper-evident.
  Editing the policy in the Vault UI re-seals the value in the transaction
  that writes the row, opened under the row as that transaction finds it and
  sealed under the row as written, so two edits at once both land; widening it in the database directly, or editing the
  stored digest, leaves the value unreadable everywhere ("doesn't match its
  record or policy"). A value another row already links can't be linked
  again.
- **Unreadable items.** An item that won't open doesn't hide the others: "Not
  linked yet" lists it as "Unreadable item" (not usable, not linkable) and the
  server logs why. A linked one shows the reason on its page.
- **Wrong key.** Losing or changing `SECRETS_KEY` makes stored values
  unreadable: the item reports "stored under a different SECRETS_KEY" and has
  to be re-entered. Boot is unaffected.
- **Rotation.** Move the old key to `SECRETS_KEY_PREVIOUS`, set a new
  `SECRETS_KEY` and run `pnpm secrets:rotate`. It re-seals local items and
  connection OAuth state under the new key; then remove `SECRETS_KEY_PREVIOUS`.
  An item it can't read is named and left as it was, and the script exits
  non-zero: keep `SECRETS_KEY_PREVIOUS` until that item is re-entered or
  deleted.

### From the KV store (Q4)

Before Q4 each item was a `VAULT_LOCAL:<id>` entry in the KV store
(`{policy, sealed}`), listed by a hand-kept `VAULT_LOCAL:__index`, and a
connection's header value was sealed on its row (`secret_enc`). Every start,
and `pnpm secrets:rotate`, runs `importStoredSecrets()`
(`apps/web/src/server/api/vault/vault.import.ts`) first:

- Each `VAULT_LOCAL:` entry, whether the index names it or not, is copied
  byte for byte into `vault_values`: same id, ciphertext and digest, so
  nothing is re-encrypted. The copy is read back, then the KV entry is
  deleted. An entry already in the table is stale and is deleted.
- An entry not in that format stays in KV and is logged, and so is the index
  while anything is left. An entry another key sealed moves anyway and is
  logged as unreadable; it opens once that key is `SECRETS_KEY_PREVIOUS`.
- Each `secret_enc` becomes the connection's own vault item, checked and
  cleared in one transaction. One that can't be opened stays and is logged.

A second run finds nothing to move. The start never fails because of it.

## Limits (v1)

- No passkeys/WebAuthn or push approvals on sites: the bot asks the owner to
  finish those during browser takeover.
- No protection against a compromised destination site, or against code
  running as the app's own user.
- Deferred: Bitwarden (Secrets Manager / Password Manager), OpenBao and
  Bitwarden Agent Access backends, "fill from photo" for cards, and
  proxy-based credential injection for sandbox processes.
