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
(`packages/models/src/kinds.ts`):

| Kind                    | Wire API                     | Engine      | Key                                  |
| ----------------------- | ---------------------------- | ----------- | ------------------------------------ |
| `anthropic`             | Anthropic Messages           | pi          | API key                              |
| `openai-chat`           | OpenAI Chat Completions      | pi          | API key, or none (Ollama, LM Studio) |
| `openai-responses`      | OpenAI Responses             | pi          | API key                              |
| `gemini`                | Google Generative AI         | pi          | API key                              |
| `cloudflare-ai-gateway` | The gateway's catalog        | pi          | Gateway token                        |
| `claude-plan`           | none: the Claude Code worker | claude-code | none (signed in on the sandbox)      |
| `faux`                  | none: the host's faux model  | pi          | none (dev, e2e and tests)            |

- **Cloudflare AI Gateway.** One account serves everything the gateway
  holds, on the gateway's token: the providers whose keys are stored in it
  (BYOK: Anthropic, TypeSafe's Jev classifier), its Unified Billing
  catalog, and its **custom providers** (issue #216). A custom provider is
  listed in the account's `settings.customProviders` by its gateway slug and
  the path the gateway appends (`custom-zai-coding-plan`,
  `api/coding/paas/v4`). Its models are rows named `<slug>/<model>`
  (`custom-zai-coding-plan/glm-5.3-flash`), served from
  `gateway/v1/<account>/<gateway>/<slug>/<basePath>` under their bare id;
  the gateway's unified `/compat` endpoint can't add the provider's path.
  Discovery lists each custom provider's `/models` beside the catalog, and
  a model it doesn't list can be added by id. A `custom-…` model whose
  slug isn't in the settings still goes to `gateway/…/<slug>` (never
  `/compat`, which 404s for every custom provider); its row says the
  provider isn't set up, **Custom providers** opens with the slug filled
  in, and Test reads an upstream 404 as a missing or wrong base path.
  Cloudflare's API to list custom providers needs a token with AI Gateway
  edit rights, so the base paths are entered by hand.
- **Gateway route.** An `openai-chat` account can also go through a gateway
  account instead of an endpoint of its own (`viaProviderId`,
  `settings.upstream`, `settings.basePath`). The API keeps it; the dialog
  offers custom providers on the gateway account instead.
- **Thinking.** Models that always think adaptively (Claude Sonnet 5.5,
  Opus 5.5) refuse `thinking: {type: "disabled"}`, which pi-ai sends for a
  call with no thinking level. Their "off" level is marked unsupported, so a
  Test, a title or a memory capture leaves thinking to the model.
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
compat flags. A row's flags go on top of pi-ai's catalog flags, never in
place of them, and a gateway Claude model carries Anthropic's own (native
tool changes keep the prompt cache when a bot loads deferred tools). A model
the upstream stopped listing keeps its row
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

| Role             | Used by                                                             | Unset                                                                 |
| ---------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `bot_default`    | New bot; bots without a model                                       | The first available chat model                                        |
| `code_default`   | New [Code](./code.md) threads of the native harness                 | `bot_default`, else the first model, each on pi                       |
| `memory_capture` | [Memory](./memory.md) capture                                       | The bot's model, else `bot_default`, else the first model, each on pi |
| `chat_title`     | [Past chat](./past-chats.md) titles; [Code](./code.md) branch names | The bot's model, else `bot_default`, else the first model, each on pi |
| `vision`         | [Image transcription](./chat-attachments.md)                        | The first available model that sees images                            |
| `classifier`     | [Auto-review](./auto-review.md)                                     | None: auto-review asks the owner                                      |

## Settings → Models

The owner manages all of this in **Settings → Models** (`/settings/models`), with
no restart:

- **Add models.** "Connect a provider": pick a kind or a template
  (Anthropic, OpenAI, Gemini, OpenRouter, Cloudflare AI Gateway, Groq,
  DeepSeek, Mistral, Together, z.ai, z.ai Coding Plan, Ollama, Claude plan),
  enter the endpoint and key, **Check models**, keep the ones you want
  (aggregators start with none checked), **Connect**. "Add a single model":
  one model by id, with max output, image input and (Advanced) context
  window and reasoning set by hand, and **Test** before **Add**.
- **Accounts.** Each card shows the kind, host, key hint ("sk-…a1B2") and
  where the key is kept, a status (Connected, Key rejected, Unreachable,
  Locked: re-enter key, Disabled) and when it was checked. Expanded, it lists
  its models with an enable box, capabilities, how many bots use each, Test
  and delete, plus **Add a model**: a search over what the endpoint lists
  and the account lacks (the Add models dialog's list), or any typed id.
  The Claude plan's card picks its fallback model.
- **Default models.** One row per role, showing its model and whether it is
  the fallback; Reset clears a role.
- **Delete in use.** Deleting an account or model that bots, roles or the
  Claude plan's fallback use asks which model takes over, then moves them.
  The model that takes over must be one each could be set to: a classifier
  for the classifier role, a chat model for bots and the other roles, and a
  model that runs on pi for the fallback. Anything else is refused (400) and
  nothing moves.

Creating an account, changing its endpoint, and deleting it need the
vault's step-up (password or passkey): a stolen session that could repoint an
account would receive every prompt sent through it. Replacing only the key,
and discovering or testing an endpoint, don't. A new host needs the key
again. Changes reach open pickers through `models.changed` on `/events`.

### API (owner only)

| Route                                         | Step-up | Purpose                                                    |
| --------------------------------------------- | ------- | ---------------------------------------------------------- |
| `GET /api/v1/models/providers`                |         | Accounts, their models and key hints; templates            |
| `POST /api/v1/models/discover`                |         | List an endpoint's models without saving                   |
| `POST /api/v1/models/providers`               | yes     | Create an account (discovers again, stores the key)        |
| `PATCH /api/v1/models/providers/:id`          |         | Name, enabled, Claude plan fallback; `If-Match: <version>` |
| `PUT /api/v1/models/providers/:id/connection` | some    | Endpoint, key, private network (a key alone needs none)    |
| `GET /api/v1/models/providers/:id/available`  |         | Listed models the account lacks (Add a model); reads only  |
| `POST /api/v1/models/providers/:id/refresh`   |         | Discover again; marks models no longer listed              |
| `DELETE /api/v1/models/providers/:id`         | yes     | 409 `in_use` unless `?moveTo=<modelId>`                    |
| `POST /api/v1/models/providers/:id/models`    |         | Add a model by id                                          |
| `PATCH` / `DELETE /api/v1/models/:id`         |         | Name, enabled, overrides / delete (same in-use rule)       |
| `POST /api/v1/models/test`                    |         | One 16-token completion, saved model or unsaved account    |
| `GET` / `PUT /api/v1/models/roles`            |         | Roles and whether each is the fallback                     |

Bodies are strict (unknown fields are refused) and capped at 64 KB. No
response carries a key. A Claude.ai token (`sk-ant-oat…`) is refused.

### Outbound guard

Discovery goes through one guarded GET (`models.fetch.ts`): https only (http
only for an account that allows a private endpoint), no credentials, query or
fragment in the endpoint, the address checked after DNS when the socket
connects (private addresses refused unless allowed), no redirects, 15 s and
4 MB per request, at most 50 pages and 5,000 models. An unsaved test call passes pi-ai's client
a guarded fetch of its own: each redirect hop is resolved and checked against
the private-address ban before it is followed, so an endpoint that redirects
to a private address is refused unless the account allows one. Saved accounts
are checked when the endpoint is stored.

### Account limits

A model that fails on the provider's side says why. The gateway answers
402 (code 2021) for a provider whose key it doesn't hold and that has no
Unified Billing credits, and Workers AI answers 403 (internal code 5035) for
a model the Workers Free plan doesn't include. Test explains both before the
raw error. The gateway's Workers AI models are named `… (Workers AI)` so they
aren't mistaken for the owner's own providers.

## The runtime

The app reads the tables into a `ModelConfig` snapshot
(`apps/web/src/server/api/models/models.config.ts`) and hands it to
`AgentRuntime` with a `CredentialResolver` that asks the vault. Provider
kinds, discovery, test calls, `buildProviders` and the Model catalog live in
`@tiny-agents/models` (`packages/models`), which uses pi-ai only: it imports
neither pi-durable nor `@tiny-agents/agent` (lint R11). Neither package
reads the database or env for models.
`runtime.applyModelConfig` replaces the pi-ai providers in place, so a change
applies from the next request without a restart; running turns keep the
model they resolved. After every committed change the app calls
`reloadModels()`.

The Model catalog (`packages/models/src/model-catalog.ts`) is a projection of
the snapshot: `list`, `get`, `route` (engine, pi provider, upstream id),
`piModel`, `forRole`, `providers` and `canAnswer`. `GET /api/v1/models`
returns `{ models, defaultModelId, canAnswer, providers }`.

## Dev and tests

`TINY_AGENTS_FAUX=1` seeds a `faux` account with the model `test-model` and
boots on pi-ai's faux provider. Tests seed the same account with the model
ids they name (`tests/server/setup.ts`).
