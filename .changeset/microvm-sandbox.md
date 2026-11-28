---
"tiny-agents": minor
"@tiny-agents/sandbox": minor
---

The sandbox can now run on an AWS Lambda MicroVM. Set `SANDBOX_PROVIDER=microvm` with an image from `pnpm sandbox:microvm:image` and an IAM role, and bots get the same shell, browser, desktop and terminal there. You don't store any AWS keys or SSH keys: the app signs in to AWS with its own OIDC tokens (published at `/.well-known/openid-configuration`) and gives each VM a fresh SSH key when it starts it. A VM lasts at most 8 hours, after which new work moves to a fresh one; files, browser logins and terminal tabs don't carry over. Setup and local testing are in `docs/guides/microvm-sandbox.md`.
