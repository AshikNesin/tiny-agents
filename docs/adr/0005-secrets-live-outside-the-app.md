# 0005 — Secrets bots use live outside the app; the model only sees handles

- Status: accepted (amended by [0015](0015-one-secrets-subsystem.md): the vault also
  holds the app's own credentials, as `app` items)
- Date: 2026-10-29
- Issue: #56

## Context

Bots need the owner's website logins, payment cards, 2FA codes and API keys
to do real work. Two things must hold at once: the model (and its provider,
gateway logs and transcripts) never sees a value, and tiny-agents doesn't
become the system of record for the owner's credentials — losing the app's
volume must not leak them, and rotating one must not need an app change.

## Decision

- Values live in an **external manager**: 1Password, read through a
  self-hosted **Connect** server, limited to one dedicated "tiny-agents"
  vault. A `local` backend (AES-GCM with `SECRETS_KEY`) is the fallback.
  Both sit behind one `VaultBackend` port so others (Bitwarden, OpenBao) can
  follow.
- The app stores **references and policy only** (`VaultItem`), plus an
  append-only `VaultAuditEvent` log without values.
- The model sees **opaque handles**. A value is resolved **at the tool
  boundary**, after policy and approval, and handed only to a **sink** (a
  browser field over CDP, a header on a server-made request, an MCP
  connection header) through `VaultBroker.use(…, sink)`; no tool returns a
  value and there is no agent "reveal".
- **Two Connect tokens**: the agent runtime holds a read-only one; a
  read+write one is loaded only by the owner's Vault UI routes, behind
  step-up re-authentication. A startup guard refuses any token that can see
  a vault besides the pinned one.
- **Item-level approval** on top of tool permissions: logins and keys ask
  once per chat by default, cards on every use (no override), approvals
  expire after 10 minutes, and unattended runs (routines, peer bots) are
  refused unless the item allows them — cards never.
- A process-wide **redactor** scrubs every resolved value (and its
  encodings) from tool results, transcripts, logs and Sentry, as a backstop.
- When no item exists, a **credential request** sheet lets the owner type
  into a server-filled form bound to the page's origin; the bot learns only
  which fields were filled.

## Consequences

- A value can still reach a site the item allows — that site then has it.
  Exact-origin binding, checked twice (and once more inside the page), is
  the guard against prompt-injected phishing; it can't help against a
  compromised destination.
- Code running as the app's user can read process memory; this design
  doesn't defend against that.
- Connect becomes a dependency for vault uses only: when it is down, uses
  fail closed and the rest of the app keeps working.
- Sandbox env injection (`run_command` secrets) is the one sink where
  model-written code holds the secret. It asks on every use with the full
  command shown, and runs the command in a systemd unit the command can't
  loosen (no privilege escalation, a kernel IP allowlist of the items' hosts,
  no unix sockets, no DNS beyond them). A command can still write the value
  where a later unconfined command reads it; the owner's review of the
  command is the control for that.

## Alternatives considered

- **Storing values in the app database** — makes tiny-agents the system of
  record and a single volume theft a full leak.
- **Bitwarden Password Manager** — no supported REST path to decrypted items
  (`bw serve` is unauthenticated once unlocked); a CLI adapter remains a
  later option. **Bitwarden Secrets Manager** has REST but no login items.
- **OpenBao / Vault** — fully self-hosted REST, but not zero-knowledge and
  no login/card item model.
- **1Password Service Accounts** — SDK/CLI only, no REST, and request quotas.
