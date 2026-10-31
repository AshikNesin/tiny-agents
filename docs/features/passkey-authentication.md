# Passkey authentication

Passwordless sign-in with WebAuthn (Face ID, Touch ID, Windows Hello, security
keys) on top of the password flow. Server: `packages/core/src/passkey/` on
`@simplewebauthn/server`. Client: `passkeyService` from
`@groot/shell/services/passkey` on `@simplewebauthn/browser`, and the
`<PasskeyManager />` component.

## How it works

**Registration** (signed in): `POST /register/options` returns creation
options and stores the challenge → the browser creates a credential →
`POST /register/verify` checks it and saves the passkey (public key, counter,
transports, device type, a name such as "This device").

**Login** (public): `POST /login/options` (an optional `email` narrows
`allowCredentials` to that user's passkeys) → the browser signs the challenge →
`POST /login/verify` verifies the signature and counter, updates `lastUsedAt`,
sets the `token` cookie and returns `{ token, user }` like password login.

Challenges live in the `kv` table (`passkey:challenge:` namespace) with a
five-minute TTL and are consumed on first use, so they survive restarts and
work across Workers isolates. A user can register any number of passkeys; the
last one cannot be deleted.

## Configuration

The relying party comes from the environment through `config.passkey`:

| Variable  | Dev default             | Production                                   |
| --------- | ----------------------- | -------------------------------------------- |
| `RP_NAME` | `Groot`                 | Name shown in the browser prompt             |
| `RP_ID`   | `localhost`             | **Required**: your domain, no scheme or port |
| `ORIGIN`  | `http://localhost:3000` | **Required**: `https://your-domain`          |

Under portless set `RP_ID=groot.localhost` and `ORIGIN=https://groot.localhost`
in `.env`. On Cloudflare they are `vars` in `wrangler.jsonc`. WebAuthn needs
HTTPS everywhere except `localhost`.

## API (`/api/v1/passkey`)

| Method | Path                | Auth   | Body                            | Returns                          |
| ------ | ------------------- | ------ | ------------------------------- | -------------------------------- |
| POST   | `/register/options` | JWT    |                                 | `200` creation options           |
| POST   | `/register/verify`  | JWT    | `{ response, credentialName? }` | `200` the passkey                |
| POST   | `/login/options`    | public | `{ email? }`                    | `200` request options            |
| POST   | `/login/verify`     | public | `{ response }`                  | `200` `{ token, user }` + cookie |
| GET    | `/list`             | JWT    |                                 | `200` the user's passkeys        |
| PATCH  | `/:id`              | JWT    | `{ credentialName }`            | `200` the passkey                |
| DELETE | `/:id`              | JWT    |                                 | `204`                            |

The login routes share the auth rate limit (20 requests / 15 min per IP).

A passkey comes back as `{ id, credentialName, kind, label, backedUp, canDelete,
lastUsedAt, createdAt }`, never with the public key or credential id. The server
decides what the client shows: `kind` is `"security-key"` (USB, NFC or
Bluetooth transports), `"synced"` (a `multiDevice` credential) or `"device"`;
`label` names it ("Security key (USB)", "Synced passkey", "Device-bound
passkey"); `canDelete` is `false` for the user's last passkey, which `DELETE`
refuses.

## Client

```ts
import { passkeyService } from "@groot/shell/services/passkey";

await passkeyService.registerPasskey("My laptop"); // signed in
await passkeyService.listPasskeys();
await passkeyService.updatePasskeyName(passkeyId, "Work laptop");
await passkeyService.deletePasskey(passkeyId);
```

Passkey sign-in is part of the session: `useAuthStore.getState().loginWithPasskey()`
(`@groot/shell/store/auth`) runs the browser ceremony and starts the session.

```tsx
import { PasskeyManager } from "@groot/shell/components/PasskeyManager";

<PasskeyManager />; // list, add, rename, delete — used on the settings page
```

## Security properties

| Property                    | How                                                                           |
| --------------------------- | ----------------------------------------------------------------------------- |
| Challenge-response          | One-time challenge stored server-side, consumed on first use, five-minute TTL |
| Counter validation          | The authenticator counter must advance; a cloned credential fails             |
| Public keys only            | Private keys never leave the device                                           |
| Origin and RP checks        | Responses are verified against `ORIGIN` and `RP_ID`                           |
| User verification preferred | Biometric or PIN requested on registration and login                          |

## Troubleshooting

| Symptom                          | Likely cause                                               | Fix                                             |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| Registration or login fails      | `RP_ID` / `ORIGIN` do not match the page's origin          | Set them to the real domain and origin; restart |
| `NotAllowedError` in the browser | User cancelled, no user gesture, or duplicate registration | Trigger from a click; check the passkey list    |
| "Challenge not found or expired" | More than five minutes passed, or the page was refreshed   | Start the flow again                            |
| "Cannot delete the last passkey" | By design                                                  | Add another passkey first                       |

## Schema

The `passkeys` table is defined in `packages/core/src/database/schema.ts`
(`userId` → `users.id` with cascade delete, unique `credentialId`, `publicKey`
blob, `counter`, `transports` JSON, `deviceType`, `backedUp`, `credentialName`,
`lastUsedAt`). Change it the normal way: edit the schema, `pnpm db:generate`.

## Resources

- [WebAuthn Guide](https://webauthn.guide/)
- [SimpleWebAuthn](https://simplewebauthn.dev/)
- [Passkeys.dev](https://passkeys.dev/)
