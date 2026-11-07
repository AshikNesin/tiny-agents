# Models

Models are owner data (issue #179, [ADR 0016](../adr/0016-models-are-owner-data.md)).
The owner adds **provider accounts** and their **models** in the app, and
features pick their model through **model roles**. Env vars do not configure
models.

## Provider accounts

A provider account is a row in `providers`: a kind, an endpoint, a key and a
name the owner chooses ("Anthropic · Work"). Its row id is also its pi-ai
provider id. The kind fixes the wire API, how the key is sent, the default
endpoint and capabilities, and the engine
(`packages/agent/src/providers/kinds.ts`):

| Kind                    | Wire API                     | Engine      | Key                                  |
| ----------------------- | ---------------------------- | ----------- | ------------------------------------ |
| `anthropic`             | Anthropic Messages           | pi          | API key                              |
| `openai-chat`           | OpenAI Chat Completions      | pi          | API key, or none (Ollama, LM Studio) |
| `openai-responses`      | OpenAI Responses             | pi          | API key                              |
| `gemini`                | Google Generative AI         | pi          | API key                              |
| `cloudflare-ai-gateway` | The gateway's catalog        | pi          | Gateway token                        |
| `claude-plan`           | none: the Claude Code worker | claude-code | none (signed in on the sandbox)      |
| `faux`                  | none: the host's faux model  | pi          | none (dev, e2e and tests)            |

- **Gateway route.** An `openai-chat` account can go through a gateway
  account instead of an endpoint of its own, as the gateway's BYOK upstreams
  do: its URL is `gateway/v1/<account>/<gateway>/<upstream>[/<basePath>]` and
  it uses the gateway's token (`viaProviderId`, `settings.upstream`).
- **Claude plan.** Adding the account opts in; turning it off is the kill
  switch, read on every turn. `settings.fallbackModelId` names a pi model a
  turn moves to when the plan is off or the worker is unreachable; without
  one the turn pauses. See [Claude subscription](../claude-subscription.md).

## Keys

Every key is a vault item with audience `app`
([ADR 0015](../adr/0015-one-secrets-subsystem.md)), resolved per request
through the `provider` sink for the account's own host. Bots never see it.
Resolved keys are cached for five minutes. A key the vault can't open marks
the account `locked`, and its models show "re-enter key".

## Models

A model is a row in `models` under an account: the upstream id, a display
name, a type (`chat` or `classifier`), its capabilities (context window, max
output, image input, reasoning), whether the picker offers it, and pi-ai
compat flags. A model the upstream stopped listing keeps its row
(`missingSince`), so bots that use it still point at something.

A bot points at a model row (`bots.model_ref`), not at a string. The database
refuses to delete a model a bot or a role uses. A bot with no model runs on
the `bot_default` role. Every surface names a model as
`<account name> / <model name>`; nobody reads or types the row ids.

A model can run when its account is enabled and not `locked`, `key_rejected`
or `unreachable`, and the model is still listed. The picker greys out the
others with the reason.

## Model roles

Features that call a model on their own read a role (`model_roles`), with a
documented fallback when it is unset (`ModelCatalog.forRole`):

| Role             | Used by                                      | Unset                                      |
| ---------------- | -------------------------------------------- | ------------------------------------------ |
| `bot_default`    | New bot; bots without a model                | The first available chat model             |
| `memory_capture` | [Memory](./memory.md) capture                | The bot's model on pi, else `bot_default`  |
| `chat_title`     | [Past chat](./past-chats.md) titles          | The bot's model on pi, else `bot_default`  |
| `vision`         | [Image transcription](./chat-attachments.md) | The first available model that sees images |
| `classifier`     | [Auto-review](./auto-review.md)              | None: auto-review asks the owner           |

## The runtime

The app reads the tables into a `ModelConfig` snapshot
(`apps/web/src/server/api/models/models.config.ts`) and hands it to
`AgentRuntime` with a `CredentialResolver` that asks the vault.
`packages/agent` never reads the database or env for models.
`runtime.applyModelConfig` replaces the pi-ai providers in place, so a change
applies from the next request without a restart; running turns keep the
model they resolved. After every committed change the app calls
`reloadModels()`.

The Model catalog (`packages/agent/src/model-catalog.ts`) is a projection of
the snapshot: `list`, `get`, `route` (engine, pi provider, upstream id),
`piModel`, `forRole`, `providers` and `canAnswer`. `GET /api/v1/models`
returns `{ models, defaultModelId, canAnswer, providers }`.

## Dev and tests

`TINY_AGENTS_FAUX=1` seeds a `faux` account with the model `test-model` and
boots on pi-ai's faux provider. Tests seed the same account with the model
ids they name (`tests/server/setup.ts`).
