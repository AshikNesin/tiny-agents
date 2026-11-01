# ADR 0006: The computer is a desktop on the sandbox VM

- Status: **accepted**
- Date: 2026-11-01
- Issue: #108

## Context

Bots could use a browser (#24), a sandbox shell (#19) and a terminal (#28),
but no bot could use a computer: open a desktop app, work in a file manager,
edit a document, finish a task that only exists behind a GUI. The products
this app mirrors give each account one Linux VM with a screen per bot, and
every computer-use model was trained against the same reference stack: an X
display, `xdotool` to act, a screenshot tool to see, noVNC to watch.

Revisions 1 and 2 of the issue designed the computer as a macOS machine on
the tailnet: Screen Sharing (RFB with Apple's DH authentication) for the live
view and pixel input, and an accessibility CLI over SSH for semantic actions.
Every maintained macOS agent needs a process inside the GUI session holding
Accessibility and Screen Recording grants; SSH-spawned screenshots fail; the
machine must never lock or sleep; and the bot ends up on a real computer
with the owner's account rather than in a disposable VM.

The sandbox VM already has what the browser feature built for its own live
view: a private Xtigervnc display per profile reached only through SSH, a
VNC bridge with one-time tickets, a driver flag for takeover, a first-run
installer and a VM-wide launch lock.

## Decision

- The computer is an XFCE desktop on the sandbox VM, one per browser
  profile, on its own X display beside the browser's Chrome. It installs
  itself with `apt` on first use (Debian packages only).
- The bot sees with `scrot` and acts with `xdotool` (plus `wmctrl` and
  `xclip`), one SSH exec per call, at a fixed desktop size, so screenshot
  pixels and click coordinates are the same. No accessibility tree in v1.
- The live view and takeover reuse the browser's VNC path: the bridge is
  generalised (`desktop.vnc.ts`) and the viewer scales the fixed desktop
  instead of resizing it. Takeover is the driver flag, plus a bot-initiated
  takeover request and no screenshots while the owner drives.
- No agent runtime on the VM and no second machine. Shell and files stay in
  the sandbox toolkit on the same VM.

## Consequences

- Nothing new is reachable from the network and no new credentials exist:
  the VM's keyless Tailscale SSH and pinned host key cover the computer too.
- Prompt injection from screen content lands in the bots' disposable VM, not
  on the owner's machine; approvals on every effect remain the main control.
- Memory on the VM bounds how many desktops run at once (about 300 MB each
  plus apps).
- macOS or Windows apps are out of reach; a different machine would be
  another transport behind the same `ComputerDesktop` port.
- The browser's Chrome runs on its own display in v1; moving it inside the
  desktop is the first follow-up.

## Alternatives considered

- **A Mac over Screen Sharing and an accessibility CLI** (revisions 1–2):
  more moving parts (Apple auth in the bridge, TCC grants, sleep and lock
  settings, an installer for a third-party binary) and the bot on a real
  computer. Rejected for v1.
- **Moving the sandbox to a hosted desktop VM** with the stack preinstalled:
  a separate decision about the sandbox (its SSH path and pause rules), not
  about the computer; the toolkit would be the same.
- **GNOME or a bare window manager:** GNOME costs several times the memory;
  a bare window manager leaves the bot without a launcher or file manager.
