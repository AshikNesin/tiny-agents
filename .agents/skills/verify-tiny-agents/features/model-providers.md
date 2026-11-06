# Model providers

A user sees which AI providers can answer through the model catalog: the bot dialog's model picker groups models by provider (faux in verify runs, plus the Claude-plan rows labelled `uses your Claude plan`), the chat composer's model chip switches a bot's model and saves it, and with a configured provider the chat has no warning banner and sending works. Providers themselves are configured with server env vars (`AI_PROVIDERS`, provider keys), not in the UI.

## Sub-features

- `providers-catalog`: `GET /api/v1/models` returns `models`, `defaultModel`, `gatewayConfigured` ("some provider can answer") and `providers` (`id`, `name`, `configured`, `setupHint`).
- `providers-picker`: the bot dialog's model button (named after the selected model) opens a menu grouped `<family> · <provider>` when more than one provider serves models (`Other · faux`, `Claude plan · Claude plan`), with `reasoning` or the model's note (`uses your Claude plan`).
- `providers-chip`: composer chip (`data-testid=chat-model`) → searchable list (`Search models…`, options per model with context size and note) → saves the bot's model.
- `providers-configured`: no `No model provider is configured…` banner, sending enabled, the faux model replies `Echo: …`.
- `providers-unconfigured` (banner listing each provider's setup hint, sending disabled) and `providers-model-gone` (`<id> is no longer in the model catalog` + `Choose a model`, picker `(no longer available)`): not reachable in verify runs (see Gotchas).

## How to get to it (user POV)

- New bot: `/chats` → `Create your first bot` or `New bot` → model button in the dialog. Existing bot: `<bot> actions` → `Edit bot` → `Profile`.
- In a chat (`/chats/<botId>`): the model chip in the composer toolbar.

## Driving it with ta-verify

Preconditions:

- Baseline run (faux on), doctor OK, signed in. No bot named `Model Bot <stamp>`.

- **Catalog.** `GET /api/v1/models`: `gatewayConfigured: true`, `defaultModel: "test-model"`, `providers` = `[faux, configured]`, models include `test-model` and `claude-code/*`.
- **Picker.** Open the New bot dialog; button `Test Model (faux)` (preselected default) → menu has `Other · faux`, `Claude plan · Claude plan`, menuitem `Test Model (faux) reasoning` and each Claude model with `uses your Claude plan`.
- **Pick + create.** Pick a Claude-plan model (button renames), switch back to `Test Model (faux)`, Name `Model Bot <stamp>`, `Create bot`; `GET /api/v1/bots` has `modelId: "test-model"`.
- **Chip.** `/chats/<botId>`: chip shows `Test Model (faux)`; open, search the Claude model, pick its option → chip renames, bot `modelId` becomes `claude-code/…`; switch back to faux the same way.
- **Configured.** No provider or catalog banner; send `model <stamp>` → `Echo: model <stamp>`.
- **Proof.** `ta-verify drive $S/journeys/model-providers.mjs` → `model-providers/picker-groups`, `chip-switched`, `faux-replied`.

## Gotchas

- Verify runs always boot the faux provider, which counts as configured, so the "no provider configured" banner cannot appear. Seeing it needs a boot without `TINY_AGENTS_FAUX` and without provider keys; real providers need `AI_PROVIDERS` and their keys (or `CLOUDFLARE_*` for the gateway). Neither is reachable here.
- "No longer available" needs a bot whose saved `modelId` left the catalog. The API refuses unknown model ids, so this needs a restart with a different provider list: unreachable.
- Sending to a `claude-code/*` model needs Claude Code installed and signed in on the worker; the journey only switches to it and back, never sends.
- The picker's group labels include the provider only when more than one provider serves models (faux + Claude plan in verify runs).
