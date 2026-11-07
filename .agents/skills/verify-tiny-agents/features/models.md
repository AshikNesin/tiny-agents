# Models

Models are owner data (issue #179): provider accounts, their models and the
model roles live in the database. Verify runs boot with `TINY_AGENTS_FAUX=1`,
which seeds a `Faux` account with one model, `Test Model (faux)`.

## Sub-features

- `models-settings`: Settings → Models (`/settings?tab=models`): the `Faux` card, Add models → Claude plan → `Check models` (three static models, no network) → `Connect` behind step-up → a `Claude plan` card with its models, `Fallback model` and the `Claude plan engine` region (engine on; `Disable` → `The engine is off. Enable this account to turn it on.`, no `claude-plan-account`, no `claude-plan-sign-in`); `Default models` table.

- `models-catalog`: `GET /api/v1/models` returns `models` (each with `providerName`, `available`, `unavailableReason`), `defaultModelId`, `canAnswer` and `providers` (`id`, `name`, `kind`, `status`, `enabled`, `modelCount`).
- `models-picker`: the bot dialog's model button opens a menu grouped by account name (`Faux`); a model that can't run is greyed out with its reason.
- `models-chip`: composer chip (`data-testid=chat-model`) → searchable list → saves the bot's model.
- `models-configured`: no `No model is set up` banner, sending enabled, the faux model replies `Echo: …`.

## How to get to it (user POV)

- New bot: `/chats` → `Create your first bot` or `New bot` → model button in the dialog.
- In a chat (`/chats/<botId>`): the model chip in the composer toolbar.

## Driving it with ta-verify

- **Catalog.** `GET /api/v1/models`: `canAnswer: true`, `defaultModelId: "test-model"`, one `Faux` provider.
- **Picker.** Open the New bot dialog; button `Test Model (faux)` → a searchable list (`Search models…`), options grouped by account (`Faux`).
- **Configured.** No banner; send `model <stamp>` → `Echo: model <stamp>`.
- **Settings.** `ta-verify drive $S/journeys/models.mjs` → `models-tab`, `models-checked`, `models-plan-added`, `models-plan-card`, `models-picker`. With the plan added and no default set, New bot preselects `Claude Haiku 4.5` (the first available chat model by account name).

## Against a real gateway

`ta-verify drive $S/journeys/models-gateway.mjs` with `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID` and `CLOUDFLARE_API_KEY` in the shell that drives (never the server's env; without them it reports unreachable). It adds one gateway account with the custom provider `custom-zai-coding-plan` (`api/coding/paas/v4`), keeps Claude Sonnet 5.5, the custom GLM 5.3 models and Jev, Tests Sonnet and GLM-5.3-Flash, sets New bots and Auto-review, and chats with a bot on Sonnet 5.5 (`pong`) and then GLM-5.3-Flash (`ping`). Proofs: `gateway-checked`, `gateway-tested`, `gateway-defaults`, `gateway-sonnet-reply`, `gateway-glm-reply`. Real model calls, a few tokens each.

## Gotchas

- Real providers (Anthropic, OpenAI, the gateway) need network and keys: unreachable here. The Claude plan account lists statically, so the dialog's whole path is drivable; sending on it needs Claude Code signed in on the sandbox.
- The faux account always answers, so the "No model is set up" banner needs a boot without `TINY_AGENTS_FAUX` and with no accounts.
