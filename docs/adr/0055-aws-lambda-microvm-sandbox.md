# ADR 0055: The sandbox can run on an AWS Lambda MicroVM

- Status: **accepted** (builds on [0054](0054-a-sandbox-machine-below-the-connection.md))
- Date: 2026-11-28

## Context

The sandbox is the exe.dev VM on the tailnet or the local container (ADR
0007). An AWS Lambda MicroVM is a third host, with three differences: it
takes no TCP connection (one HTTPS endpoint per VM, behind a token AWS
mints), it starts on demand and ends after at most 8 hours, and reaching it
needs AWS credentials. The app's hosts (Coolify, Railway, exe.dev) give it no
cloud identity, and the owner wants no AWS or SSH secrets to manage.

## Decision

- `SANDBOX_PROVIDER=microvm` builds a `microvmMachine`
  (`packages/sandbox/src/microvm/machine.ts`, the `@tiny-agents/sandbox/microvm`
  subpath) instead of `sshMachine`. SSH stays the protocol: the machine opens a
  WebSocket to the VM's endpoint and hands it to ssh2 as its socket.
- The image is `docker/sandbox/` plus a `microvm` stage with a bridge
  (`packages/sandbox/src/microvm/bridge.ts`) on port 8080. It pipes WebSockets
  to sshd and answers the lifecycle hooks.
- Each VM gets a new SSH key pair. The public key travels in the run-hook
  payload, which the bridge writes to `authorized_keys` once; the private key
  is kept with the VM id in the `SANDBOX` KV namespace.
- `ready()` reuses the saved VM, resumes it when suspended, and starts a new
  one when it is gone or has under 30 minutes left. The old VM is not
  terminated: its open sessions run until AWS ends it.
- The app signs in to AWS as its own OIDC issuer: an ES256 key in the `OIDC`
  KV namespace, `/.well-known/openid-configuration` and `/.well-known/jwks.json`
  served without a session, 5-minute tokens with subject `sandbox`, exchanged
  through `AssumeRoleWithWebIdentity`. `SANDBOX_AWS_AUTH=default` uses the AWS
  SDK's own chain instead. The issuer is its own setting so local testing can
  point AWS at a tunnel while passkeys stay on `ORIGIN`.

## Consequences

- No credential is configured: IAM decides who gets an endpoint token, and the
  endpoint token plus the VM's own key open a shell. Anyone who can read the
  app's database can assume the role until its trust is removed in IAM.
- The issuer must be reachable from AWS over public HTTPS.
- A MicroVM sandbox is a clean machine at least every 8 hours. Files, browser
  logins and terminal tabs on the old VM are not carried over.
- Opening VS Code on the sandbox over SSH needs a direct SSH host, so it is
  not offered for a MicroVM.
- Not yet run against a real VM: the long-lived WebSocket, a browser surviving
  suspend, and token expiry on an open connection are checked by hand first
  ([AshikNesin/tiny-agents#632](https://github.com/AshikNesin/tiny-agents/issues/632)).

## Alternatives considered

- **An HTTP agent in the VM instead of sshd.** Native to the HTTP-only
  ingress, but a second connection implementation and protocol to secure.
- **Long-lived AWS access keys in env.** Simplest, but a stored secret the
  owner wanted to avoid.
- **A key baked into the image.** One key shared by every VM, rotated only by
  rebuilding the image.
- **Terminating the old VM on replacement.** Would cut open terminal tabs and
  live views mid-task.
