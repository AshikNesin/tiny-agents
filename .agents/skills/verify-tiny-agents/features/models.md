# Models

Models are owner data (issue #179): provider accounts, their models and the
model roles live in the database. Verify runs boot with `TINY_AGENTS_FAUX=1`,
which seeds a `Faux` account with one model, `Test Model (faux)`.

## Sub-features

- `models-catalog`: `GET /api/v1/models` returns `models` (each with `providerName`, `available`, `unavailableReason`), `defaultModelId`, `canAnswer` and `providers` (`id`, `name`, `kind`, `status`, `enabled`, `modelCount`).
- `models-picker`: the bot dialog's model button opens a menu grouped by account name (`Faux`); a model that can't run is greyed out with its reason.
- `models-chip`: composer chip (`data-testid=chat-model`) → searchable list → saves the bot's model.
- `models-configured`: no `No model is set up` banner, sending enabled, the faux model replies `Echo: …`.

## How to get to it (user POV)

- New bot: `/chats` → `Create your first bot` or `New bot` → model button in the dialog.
- In a chat (`/chats/<botId>`): the model chip in the composer toolbar.

## Driving it with ta-verify

- **Catalog.** `GET /api/v1/models`: `canAnswer: true`, `defaultModelId: "test-model"`, one `Faux` provider.
- **Picker.** Open the New bot dialog; button `Test Model (faux)` → menu group `Faux`.
- **Configured.** No banner; send `model <stamp>` → `Echo: model <stamp>`.

## Gotchas

- The faux account always answers, so the "No model is set up" banner needs a boot without `TINY_AGENTS_FAUX` and with no accounts.
