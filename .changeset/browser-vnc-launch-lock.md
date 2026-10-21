---
"@tiny-agents/agent": patch
---

Browser on a VM: starting a second bot's browser no longer hangs while another
bot's browser is open. The launch lock was inherited by Xtigervnc, vncconfig
and Chrome, so it stayed held for as long as the first browser ran and every
other launch waited on it until it timed out with "VM exec timed out: start the
browser". The browser processes now release the lock, a launch waits for it at
most 25 s with a clear error, the launch script always ends by itself before
the app gives up on it (so timed-out scripts no longer pile up on the VM and
start browsers nobody can reach), and a launch that fails midway tears down
what it started. The lock file is now `~/.tiny-agents/browser-launch.lock`.
