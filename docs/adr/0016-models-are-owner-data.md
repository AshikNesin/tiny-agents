# 0016 — Models are owner data

- Status: accepted (amends [0008](0008-claude-code-engine.md) and
  [0014](0014-tool-gate-and-engine-seam.md))
- Date: 2026-11-07
- Issue: #179

## Context

Models were deployment config. `AI_PROVIDERS` and a provider's `*_API_KEY`
picked pi-ai providers; `GATEWAY_CUSTOM_PROVIDERS` added BYOK upstreams as
JSON; `GATEWAY_MODEL_ALLOWLIST` trimmed the picker. A bot stored a string in
one of three grammars (bare for the "primary" provider, `custom:<p>/<m>`,
`claude-code/<m>`) that one module parsed. Side features each had their own
variable (`MEMORY_CAPTURE_MODEL`, `CHAT_TITLE_MODEL`, `VISION_*`,
`CLASSIFIER_MODEL`) and some had hardcoded owner defaults. The Claude plan
engine was chosen by the id prefix and switched by `CLAUDE_CODE_ENGINE_*`.
Every change needed a restart, and the owner couldn't make one from the app.

## Decision

- **Provider accounts and models are rows.** A `providers` row is one way of
  reaching models: a kind, an endpoint, a key (an `app` vault item, ADR 0015) and an owner-chosen name. Its row id is also its pi-ai provider id.
  A `models` row is a model under an account, with its resolved
  capabilities.
- **A bot points at a model row** (`bots.model_ref`, a foreign key). There is
  no id grammar; the database refuses a dangling reference. A bot without a
  model runs on the `bot_default` role.
- **The kind chooses the engine.** `claude-plan` runs on the Claude Code
  engine and everything else on pi (amends ADR 0008 and 0014: no
  `claude-code/` prefix). The Claude plan account is the kill switch, read
  per turn, and names its fallback model.
- **Model roles** (`bot_default`, `memory_capture`, `chat_title`, `vision`,
  `classifier`) replace the per-feature variables and hidden defaults, each
  with one documented fallback.
- **The runtime's catalog is a projection.** `packages/agent` takes a plain
  `ModelConfig` snapshot and a `CredentialResolver`; it never reads the
  database or env for models. `applyModelConfig` swaps providers in place,
  so a change applies from the next request.
- **No migration from env.** The model env vars are no longer read. An
  install sets its accounts up again in the app.

## Consequences

- Renaming an account or a model changes no stored reference.
- Deleting a model or account in use is refused until its bots and roles
  move.
- `packages/agent` stays free of `apps/` and of storage: the app owns the
  tables and the vault; the package owns kinds, routing and the catalog.
- Bots saved before this change have no model and run on the default model
  until the owner picks one.

## Alternatives considered

- **Database providers beside env providers, with `custom:<slug>/<model>`
  ids** (the issue's v1). Keeps three id grammars, a primary provider and
  precedence rules between two config sources.
- **Encoded string ids** (`provider:<b64>:<b64>`). Unreadable, and still a
  grammar.
- **A one-time importer from the old env vars.** Not needed: there is no
  install to carry over.
