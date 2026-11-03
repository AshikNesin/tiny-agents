# Code page (Shelley)

`/code` is a first-class UI for [Shelley](https://github.com/boldsoftware/shelley),
the coding agent running on another machine. tiny-agents runs no agent loop
for it: the page drives Shelley's own HTTP/SSE API through a thin proxy, so
the browser only talks to this app (under its login) and Shelley stays on
the tailnet.

Set `SHELLEY_URL` (e.g. `http://my-vm:9999`), and `SHELLEY_TOKEN` only if a
proxy in front of Shelley wants a bearer.

## What you can do

- List recent conversations, start one (message, working directory, model).
- Watch a conversation live: streaming text, thinking, and every tool call
  with its input, live output while it runs, result and duration.
- **Steer**: sending while Shelley works injects the message into the running
  turn. **Queue** (the list icon) holds it until the turn ends instead.
- **Stop** interrupts the running turn.

## How it works

`apps/web/src/server/api/shelley/shelley.routes.ts` forwards an allowlist:

| tiny-agents (`/api/v1`)                  | Shelley (`/api`)                       |
| ---------------------------------------- | -------------------------------------- |
| `GET /shelley/status`                    | none (reports whether it's configured) |
| `GET /shelley/models`                    | `GET /models`                          |
| `GET /shelley/conversations`             | `GET /conversations?limit=50`          |
| `POST /shelley/conversations`            | `POST /conversations/new`              |
| `POST /shelley/conversations/:id/chat`   | `POST /conversation/<id>/chat`         |
| `POST /shelley/conversations/:id/cancel` | `POST /conversation/<id>/cancel`       |
| `GET /shelley/conversations/:id/stream`  | `GET /conversation/<id>/stream` (SSE)  |

The stream is relayed frame by frame onto the app's own SSE response. Shelley
replays the history first, so a reconnect just re-subscribes. The client folds
messages into rows in `apps/web/src/client/lib/shelley-api.ts`
(`buildTranscript`); Shelley's content block `Type` is numeric (2 text,
3 thinking, 5 tool use, 6 tool result). The conversation list refreshes every
5 seconds; the open conversation is fully live.
