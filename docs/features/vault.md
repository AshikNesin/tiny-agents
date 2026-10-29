# Vault (logins, cards, one-time codes and API keys)

Bots use the owner's secrets **without the model ever seeing them** (issue
#56). The model only knows opaque **handles** (`github`, `amex`, `openai`).
A value is resolved at the tool boundary, in the server process, at use
time, and goes straight into one sink: a browser field (over CDP), an HTTP
header on a request the server makes, or an MCP connection header. tiny-agents
is not the system of record: values live in **1Password** (through a
self-hosted Connect server, reading one dedicated vault), or in the `local`
fallback backend. The app database holds references and policy only.

Code: `packages/agent/src/vault.ts` (the port), `packages/agent/src/redact.ts`,
`packages/agent/src/toolkits/{vault,browser,browser-fill,web}.ts`, and
`apps/web/src/server/api/vault/`. UI: `apps/web/src/client/pages/vault/`.
Decision record: [ADR 0005](../adr/0005-secrets-live-outside-the-app.md).

## How a use flows

```
model ── handle ──▶ sink tool ── gate (tool permission + item policy + approval) ──▶ VaultBroker.use
                                                                                       │ read-only token
                                                                                       ▼
                       redactor ◀── value ── backend (1Password Connect | local) ──▶ sink (page / header)
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

| Tool                  | Toolkit   | Default | What it does                                                                                                                                                                                                                                            |
| --------------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_list`          | `vault`   | allow   | Handles + metadata the bot may use, optionally by tool or origin.                                                                                                                                                                                       |
| `browser_fill_secret` | `browser` | ask     | `{handle, field?, ref?}`: a login's password (or username) or a card's number, expiry, security code and name, on the item's exact origin. The origin is checked when planning, again before resolving, and once more inside the page before the write. |
| `browser_enter_code`  | `browser` | ask     | 2FA: with a handle whose item has a TOTP seed, the server computes the code (RFC 6238) and fills it; otherwise it opens a credential request for one code.                                                                                              |
| `request_credentials` | `browser` | allow   | Opens a credential request sheet (below). The owner's submit is the consent.                                                                                                                                                                            |
| `http_request`        | `web`     | ask     | A request the server makes itself (never through TinyFish), with `auth: <handle>` added as a header only for the item's allowed hosts. Private addresses (also after DNS) are refused; the header is dropped on a redirect to another host.             |

MCP connections take a vault handle as their header value
(`Connection.secretRef`, set with `PATCH /connections/:id { secretRef }`); it
is resolved at connect time, audited, and needs the item to allow `mcp`.

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

A turn counts as **unattended** when the conversation's latest user message
is a routine's prompt or a delivery from another bot. When in doubt it counts
as unattended, which only ever refuses more.

## Credential requests

When no item exists (or a code arrives by SMS or email), the bot calls
`request_credentials({title, purpose, fields})`. The server binds the request
to the page's **current top-level origin** (https only, except hosts in
`BROWSER_ALLOWED_PRIVATE_HOSTS`), validates the form (1–8 fields, slug keys,
short labels; text, email and select fields need an identifier `autocomplete`
such as `username`, `email` or `postal-code` — no free text, so the form
can't become a side channel), and waits like an approval. One request may be
open per chat, three per chat per hour, each for 10 minutes.

The chat shows a card that opens `/vault/requests/:taskId`: the **origin
prominently**, the bot's title and purpose, masked inputs with `autocomplete`
(so the owner's own password manager can fill them), a **Securely save to
vault** switch, **Continue**, **Live browser** and **Cancel**. On submit the
server re-checks the page's origin, fills over CDP, optionally saves a login
or card (**never a one-time code or a security code**), audits the keys
filled and resumes the bot with `{status, filled_fields, saved_item_handle?}`.
Typed values exist only in that request's memory.

## Vault UI and routes

`/vault` lists items by kind (Logins, Cards, Contacts, API keys), 1Password
items not linked yet, and the backends' status (including the scoping guard's
finding and token expiry warnings 14 days ahead). Items can be created
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
| `POST /api/v1/vault/requests/:taskId/submit` | —       | `{values, save}`: fill, optionally save, resume        |
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

### 1Password Connect (primary)

Connect decrypts inside your own infrastructure, so 1Password stays
zero-knowledge, and its access tokens are scoped per vault and expire.

1. In 1Password, create a vault named **tiny-agents** holding only the items
   bots may use (plus OTP fields where a bot should do 2FA). Your
   Personal/Private vault is never exposed: 1Password does not let Connect
   servers access the built-in Personal, Private or Employee vaults or the
   default Shared vault.
2. On 1Password.com → Developer → **Connect servers**, create a server with
   access to **only** that vault and download `1password-credentials.json`.
3. Issue two tokens for it, both limited to that vault and set to expire
   (30, 90 or 180 days):
   - `OP_CONNECT_TOKEN` — **read** (the agent runtime resolves with it);
   - `OP_CONNECT_ADMIN_TOKEN` — **read + write** (only the Vault UI's
     routes load it; no agent tool ever does).
4. Set on the app: `OP_CONNECT_HOST`, `OP_CONNECT_VAULT_ID` (the vault's
   UUID), and both tokens. Redeploy.
5. Open **Vault**: the 1Password card must say **Ready · 1 vault visible**.

**Scoping guard.** For each token the backend calls `GET /v1/vaults` before
its first use and at least every 6 hours after (the Vault page re-checks when
it loads). Unless the list is
**exactly** the pinned vault, the backend reports `token_overscoped`, names
the extra vaults, and refuses every use; the app still boots. Every path is
pinned to `OP_CONNECT_VAULT_ID`, and an item whose `vault.id` differs is
refused.

**Rotation.** Values: change them in 1Password (or the Vault UI); the next
use picks them up — nothing is cached. Tokens: issue a new one, update the
env var, redeploy, revoke the old one. The Vault page warns 14 days before a
token's `exp` claim (when the token carries one).

#### Deploying Connect: a separate host on the tailnet (recommended)

Run Connect as its **own app on a different host**, reachable **only over
Tailscale**. The app already reaches the sandbox VM over the tailnet
(`SANDBOX_HOST`), so this adds no new kind of network path, and it keeps the
blast radius small: a compromise of the app host doesn't hand over
`1password-credentials.json`, and a compromise of the Connect host doesn't
hand over the tokens (Connect needs both to decrypt anything). Traffic is
WireGuard-encrypted, so Connect's plain HTTP port is fine inside the tailnet.

- Bind Connect's port to the host's Tailscale address only (or front it with
  `tailscale serve`); give it no public domain.
- Tailscale ACLs are default-deny: grant **only the app's node** access to
  Connect's port, and give the sandbox VM no rule to it. Model-chosen
  commands run on that VM and must never reach Connect.
- If the tailnet or Connect is down, vault uses fail closed (`vault_locked`)
  and everything else keeps working.

```jsonc
// Tailscale policy (excerpt): only the app talks to Connect.
{
  "tagOwners": { "tag:op-connect": ["autogroup:admin"] },
  "grants": [
    // The app's node (today tagged tag:codevm) → Connect's API port.
    { "src": ["tag:codevm"], "dst": ["tag:op-connect"], "ip": ["tcp:8080"] },
  ],
  // No rule names tag:tiny-agents-vm as a source for tag:op-connect.
}
```

```yaml
# docker-compose.yml on the Connect host. Pin both images by digest.
services:
  op-connect-api:
    image: 1password/connect-api:<version>@sha256:<digest>
    ports: ["100.x.y.z:8080:8080"] # the host's Tailscale IP only
    volumes:
      - ./1password-credentials.json:/home/opuser/.op/1password-credentials.json:ro
      - connect-data:/home/opuser/.op/data
    restart: unless-stopped
  op-connect-sync:
    image: 1password/connect-sync:<version>@sha256:<digest>
    volumes:
      - ./1password-credentials.json:/home/opuser/.op/1password-credentials.json:ro
      - connect-data:/home/opuser/.op/data
    restart: unless-stopped
volumes:
  connect-data: {}
```

Then `OP_CONNECT_HOST=http://op-connect.<tailnet>.ts.net:8080` on the app.

The simpler alternative is a Coolify service on the **app's internal
network** (no public domain, not reachable from the sandbox VM). It works the
same way; the credentials file and the tokens then sit on one host.

### Local (fallback)

Without `OP_CONNECT_HOST`, new items go to the `local` backend: values
AES-256-GCM encrypted with `SECRETS_KEY` in the app's KV store. It's fully
writable from the Vault UI. Losing `SECRETS_KEY` makes its values unreadable.

### Field mapping (1Password)

| Kind     | Category         | Fields                                                                |
| -------- | ---------------- | --------------------------------------------------------------------- |
| login    | `LOGIN`          | purpose `USERNAME` / `PASSWORD` / `NOTES`, an `OTP` field, `urls[]`   |
| card     | `CREDIT_CARD`    | `ccnum`, `expiry` (MONTH_YEAR, `YYYYMM`), `cvv`, `cardholder`, `type` |
| identity | `IDENTITY`       | `firstname`, `email`, `defphone`, `address`                           |
| api_key  | `API_CREDENTIAL` | `credential`, `username`                                              |

The Connect reference doesn't document the `CREDIT_CARD` / `IDENTITY` field
ids; the mapping uses 1Password's template ids with a label fallback, pinned
in `tests/server/api/vault/`. **Confirm them** by fetching an item made in
the 1Password app (`GET /v1/vaults/{vault}/items/{id}`) when first setting
up, along with the `MONTH_YEAR` value format. Edits keep fields the mapping
doesn't model (read-modify-write of the whole item).

## Limits (v1)

- No sandbox env injection (`run_command` secrets) yet — that sink lets the
  model control the code holding the secret, and is phase 3 of the design.
- No passkeys/WebAuthn or push approvals on sites: the bot asks the owner to
  finish those during browser takeover.
- No protection against a compromised destination site, or against code
  running as the app's own user.
- Bitwarden, OpenBao and "fill from photo" are documented alternatives and
  later work.
