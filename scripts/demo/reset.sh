#!/bin/bash
# Fresh demo server + seed (for a retake). Run as root: it resets the VM user.
cd "$(dirname "$0")/../.."
for p in $(ps -eo pid,cmd | grep -E "scripts/demo/register.mjs apps/web/src/server/index.[t]s" | awk '{print $1}'); do kill $p; done
# A clean "VM" too: no terminal tabs or browsers left from the last take.
su - exedev -c "tmux -L ta-terminal kill-server" 2>/dev/null
for p in $(ps -u exedev -o pid=,args= | grep -E "chrome|Xtigervnc|vncconfig" | awk '{print $1}'); do kill $p 2>/dev/null; done
sleep 2
mkdir -p tmp/demo
(./scripts/demo/start.sh --fresh > tmp/demo/server.log 2>&1 &)
for i in $(seq 1 90); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/health)" = "200" ] && break; sleep 2; done
node scripts/demo/seed.mjs
