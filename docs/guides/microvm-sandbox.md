# The sandbox on an AWS Lambda MicroVM

Set `SANDBOX_PROVIDER=microvm` and the app runs its sandbox on an AWS Lambda
MicroVM instead of the exe.dev VM or the local container. Bots get the same
shell, browser, desktop and terminal. The app stores no AWS keys and no SSH
key: it signs in to AWS with its own OIDC tokens, and gives each VM a new SSH
key when it starts it. The decision is [ADR 0055](../adr/0055-aws-lambda-microvm-sandbox.md).

## How it connects

1. The app signs a 5-minute token as its own OIDC issuer and exchanges it with
   AWS STS for credentials of one IAM role.
2. With those it runs or resumes the VM (`RunMicrovm`, `ResumeMicrovm`) and
   mints a token for the VM's endpoint, good for port 8080 only.
3. It opens a WebSocket to the VM's HTTPS endpoint. The bridge in the image
   (`packages/sandbox/src/microvm/bridge.ts`) pipes it to sshd, and the app's
   one `SandboxConnection` speaks SSH over it as on any host.

A VM lives at most 8 hours. With less than 30 minutes left, new connections go
to a fresh VM, and the old one keeps its open sessions until AWS ends it.
Files, browser logins and terminal tabs do not move to the new VM.

## Settings

| Setting                            | Meaning                                                                                              | Default             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------- |
| `SANDBOX_PROVIDER`                 | `ssh` (exe.dev VM, local container) or `microvm`                                                     | `ssh`               |
| `SANDBOX_MICROVM_REGION`           | AWS region                                                                                           | required            |
| `SANDBOX_MICROVM_IMAGE`            | Image ARN from `pnpm sandbox:microvm:image`                                                          | required            |
| `SANDBOX_MICROVM_IMAGE_VERSION`    | Pin an image version                                                                                 | latest              |
| `SANDBOX_MICROVM_EGRESS_CONNECTOR` | Network connector that routes egress through your VPC                                                | public internet     |
| `SANDBOX_AWS_AUTH`                 | `oidc` (the app's own tokens) or `default` (the AWS SDK's chain: a role, a profile, `aws sso login`) | `oidc`              |
| `SANDBOX_MICROVM_ROLE_ARN`         | Role the app assumes with its OIDC token                                                             | required for `oidc` |
| `SANDBOX_OIDC_ISSUER`              | Public HTTPS URL AWS fetches the app's keys from                                                     | `ORIGIN`            |
| `SANDBOX_USER`                     | SSH user in the VM                                                                                   | `exedev`            |

`SANDBOX_HOST`, `SANDBOX_PORT` and the SSH key settings apply only to `ssh`.

## Set it up

1. **Build the image** with an operator's AWS credentials, a bucket for the
   build context and a build role Lambda can assume:

   ```bash
   pnpm sandbox:microvm:image --region us-east-1 --bucket my-builds --build-role-arn arn:aws:iam::111122223333:role/microvm-build
   ```

   It bundles the bridge, zips `docker/sandbox/` (whose last stage, `microvm`,
   adds the bridge), uploads it and calls `create-microvm-image`. Add
   `--dry-run` to print the commands only.

2. **Trust the app in IAM**: add an OIDC identity provider whose URL is the
   app's issuer (`SANDBOX_OIDC_ISSUER`, or `ORIGIN`) and whose audience is
   `sts.amazonaws.com`. AWS must reach `<issuer>/.well-known/openid-configuration`
   over public HTTPS.
3. **Create the role** the app assumes. Trust only that provider and the
   subject `sandbox`; allow `lambda-microvms:RunMicrovm`, `GetMicrovm`,
   `ResumeMicrovm` and `CreateMicrovmAuthToken` on the image and its VMs.
4. **Set the settings** above and restart the app.

## Test from localhost

| What            | How                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Logic           | `pnpm test`: the bridge, the lifecycle and the OIDC routes run with AWS faked                                                                  |
| A real VM       | `SANDBOX_AWS_AUTH=default` after `aws sso login`; everything after sign-in is the production code                                              |
| OIDC end to end | `PORTLESS=0 pnpm dev`, then `tailscale funnel 3000`, and a dev OIDC provider and role for the Funnel hostname; set `SANDBOX_OIDC_ISSUER` to it |

Funnel makes the whole local app public while it runs: stop it with
`tailscale funnel reset` after the test. A separate issuer setting keeps
passkey sign-in on localhost working, since passkeys are tied to `ORIGIN`.
