#!/bin/bash
# Turns this machine (Debian/Ubuntu amd64, run as root) into the demo's
# "sandbox VM": a keyless `exedev` user over SSH on 127.0.0.1:2222 with the
# browser stack (TigerVNC + Google Chrome), tmux, and a small repo to test.
# Idempotent; re-run it to bring sshd back after a reboot.
set -euo pipefail
cd "$(dirname "$0")/../.."
export DEBIAN_FRONTEND=noninteractive

if ! command -v sshd > /dev/null || ! command -v Xtigervnc > /dev/null || ! command -v xdotool > /dev/null; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends openssh-server sudo tmux git curl ca-certificates \
    tigervnc-standalone-server tigervnc-common tigervnc-tools xdotool \
    fonts-liberation fonts-dejavu-core fonts-noto-color-emoji
fi
if ! command -v google-chrome-stable > /dev/null; then
  T=$(mktemp -d)
  curl -fsSL -o "$T/chrome.deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq "$T/chrome.deb"
  rm -rf "$T"
fi
mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# The VM user: no password, passwordless sudo (like the tailnet VMs the app targets).
id exedev > /dev/null 2>&1 || useradd -m -s /bin/bash exedev
passwd -d exedev > /dev/null
echo "exedev ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/exedev && chmod 440 /etc/sudoers.d/exedev
# Tell the app the browser stack is already installed (STACK_VERSION in browser-vm-setup.ts).
SV=$(sed -nE 's/^export const STACK_VERSION = "([^"]+)";/\1/p' packages/agent/src/toolkits/browser-vm-setup.ts)
su - exedev -c "mkdir -p ~/.tiny-agents && touch ~/.tiny-agents/browser-stack-$SV"

# The repo Code Buddy tests in the demo.
su - exedev -c 'set -e; rm -rf ~/acme-shop; mkdir -p ~/acme-shop/src ~/acme-shop/test; cd ~/acme-shop
git init -q -b main; git config user.name "Demo User"; git config user.email "demo@example.com"
cat > package.json <<EOF
{ "name": "acme-shop", "version": "1.5.0", "type": "module", "scripts": { "test": "node --test --test-reporter=spec" } }
EOF
cat > src/cart.js <<EOF
export function total(items, { coupon } = {}) {
  const sum = items.reduce((s, i) => s + i.price * i.qty, 0);
  const off = coupon === "SAVE10" ? 0.1 : 0;
  return Math.round(sum * (1 - off) * 100) / 100;
}
export const isEmpty = (items) => items.length === 0;
EOF
git add -A; git commit -qm "Set up the cart module"
cat > test/cart.test.js <<EOF
import { test } from "node:test";
import assert from "node:assert/strict";
import { total, isEmpty } from "../src/cart.js";
const items = [{ price: 12.5, qty: 2 }, { price: 5, qty: 1 }];
test("sums line items", () => assert.equal(total(items), 30));
test("applies the SAVE10 coupon", () => assert.equal(total(items, { coupon: "SAVE10" }), 27));
test("ignores unknown coupons", () => assert.equal(total(items, { coupon: "NOPE" }), 30));
test("an empty cart totals zero", () => assert.equal(total([]), 0));
test("detects an empty cart", () => assert.ok(isEmpty([])));
test("rounds to cents", () => assert.equal(total([{ price: 0.1, qty: 3 }]), 0.3));
EOF
git add -A; git commit -qm "Add cart tests"'

# sshd on localhost only, with a host key generated here (never committed).
mkdir -p /run/sshd tmp/demo
KEY=tmp/demo/ssh_host_ed25519_key
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -f "$KEY"
if [ -f /run/sshd-demo.pid ] && kill -0 "$(cat /run/sshd-demo.pid)" 2> /dev/null; then
  echo "sshd already running on 127.0.0.1:2222"
else
  "$(command -v sshd)" -f scripts/demo/vm/sshd_config -h "$PWD/$KEY"
  echo "sshd up on 127.0.0.1:2222"
fi
