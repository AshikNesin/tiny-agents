# Threat model

tiny-agents is a single-owner app. The owner runs it on their own machine,
and bots act for the owner in a sandbox VM. This page names who can reach it,
what is worth taking, and which control stands at each boundary. A change that
weakens one of these controls needs an ADR.

## What is worth taking

- **Vault items**: website logins, cards, 2FA seeds, API keys, and the app's
  own provider keys ([ADR 0005](../adr/0005-secrets-live-outside-the-app.md),
  [ADR 0015](../adr/0015-one-secrets-subsystem.md)).
- **Signed-in sessions** in the sandbox browser and computer.
- **Memories, chats and attachments**: what the owner has told their bots.
- **Connections**: MCP servers such as GitHub or Gmail, which act as the owner.

## Who can reach it, and what stops them

| Actor                          | What they can do                                   | Controls                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                          | Everything                                         | Passkey sign-in; writes that matter (connections, vault reveals and writes) need step-up, from the tier each write route has in `apps/web/src/server/api/route-access.ts` ([passkeys](../features/passkey-authentication.md))                                                                                                                                   |
| Guest                          | Chat with the bots the owner shares                | `apps/web/src/server/api/people/guest.guard.ts` keeps them out of settings, the computer, host folders and bypass mode ([shared bots](../features/shared-bots.md)). Guests are not a tool boundary: a shared bot has the owner's connections, so its tool permissions are what protect the owner ([ADR 0041](../adr/0041-bots-share-what-the-owner-sets-up.md)) |
| The model                      | Call tools                                         | Every call goes through one gate: Allow, Ask or Off per tool ([ADR 0014](../adr/0014-tool-gate-and-engine-seam.md)). It sees vault handles, never values ([vault](../features/vault.md)). Only the owner answers a vault use, a skill save or "Always allow"                                                                                                    |
| Web pages, files, tool results | Inject instructions into what the model reads      | Fenced as untrusted data, never instructions ([attachments](../features/chat-attachments.md)). Effectful tools still ask. Browser traffic goes through a pinning proxy, so a page can't reach private addresses by DNS rebinding ([ADR 0038](../adr/0038-browser-traffic-goes-through-a-pinning-proxy.md))                                                      |
| Routine run                    | Act with nobody watching                           | The conversation is unattended: an Ask tool is refused instead of waiting, and the run fails with the reason (`isUnattendedConversation` in `packages/agent/src/policy.ts`, [routines](../features/routines.md)). A token budget stops a runaway run                                                                                                            |
| Webhook sender                 | Start a routine                                    | A secret URL; only its SHA-256 is stored, and a new URL stops the old one ([routines](../features/routines.md))                                                                                                                                                                                                                                                 |
| Peer bot                       | Message another bot                                | The receiving bot's own permissions apply; the message is a fresh, budgeted conversation                                                                                                                                                                                                                                                                        |
| MCP server                     | Return tool results, see the arguments it is given | Results are untrusted data. Connection secrets are vault items. Its tools follow the same gate                                                                                                                                                                                                                                                                  |
| Push service                   | See notification traffic                           | Pushes are end-to-end encrypted; the service sees ciphertext, size, urgency and TTL ([ADR 0026](../adr/0026-web-push-transport.md))                                                                                                                                                                                                                             |

## Out of scope

- Someone with a shell on the host or the sandbox VM.
- A model provider reading the prompts it is sent. Vault values never reach it.
