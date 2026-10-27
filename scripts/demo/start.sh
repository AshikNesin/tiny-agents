#!/bin/bash
# Demo server: fresh demo DBs, faux runtime driven by the scripted director.
# Needs Node 24 on PATH and the sandbox VM from setup-vm.sh.
set -e
cd "$(dirname "$0")/../.."
export DATABASE_URL=file:./tmp/demo.db AGENT_DB_PATH=./tmp/demo-agent.db PORTLESS=0
# The machine doubles as the sandbox VM (scripts/demo/vm/sshd_config on :2222).
export SANDBOX_HOST=127.0.0.1 SANDBOX_PORT=2222 SANDBOX_USER=exedev BROWSER_SCALE=1
# Placeholder gateway values: the faux model never calls out, but boot needs them.
export DEMO_TOKENS_PER_SECOND=40 CLOUDFLARE_ACCOUNT_ID=demo-account CLOUDFLARE_API_KEY=demo-key TINYFISH_API_KEY=demo-key TZ=Asia/Kolkata # gitleaks:allow
if [ "$1" = "--fresh" ]; then rm -f tmp/demo.db* tmp/demo-agent.db*; fi
pnpm exec varlock run -- prisma migrate deploy > /dev/null
pnpm exec varlock run -- tsx apps/web/prisma/seed.ts > /dev/null
TINY_AGENTS_FAUX=1 exec pnpm exec varlock run -- tsx --import ./scripts/demo/register.mjs apps/web/src/server/index.ts
