---
"@groot/web": minor
"@tiny-agents/agent": minor
---

Terminal: copy/paste that works and a steadier screen. Ctrl+V (and
Ctrl+Shift+V, Shift+Insert, Cmd+V) now pastes from the browser, bracketed,
even on plain-http pages; xterm used to turn Ctrl+V into ^V. Dragging over
text in tmux copies it to the browser clipboard (tmux `set-clipboard on`
plus an OSC 52 handler that accepts tmux's empty selection and refuses
clipboard reads from the VM), with a "Copied" toast; Shift/Option+drag
selects locally and Ctrl+C / Ctrl+Shift+C / Cmd+C copies it. Right-click
opens a Copy / Paste / Select all menu, and the keys panel's paste is a
real (bracketed) paste. Glitch fixes: unicode11 widths so emoji/CJK line up
with tmux, truecolor through tmux, tabs attach at the rendered size (no
120x34-then-resize redraw), a second browser tab or device no longer kicks
the first off (no `attach -d`), the grid no longer widens its own column,
hidden tabs never shrink the pty, and the terminal resets before a
re-attach redraws. Pings run while the page is visible (no idle reconnect
while reading; half-open sockets are detected) and the server pauses on
client back-pressure. New: font size controls (A-/A+, Ctrl/Cmd +/-/0), a
cols×rows badge while resizing, tuned light/dark ANSI palettes, Cmd/Ctrl+
click links, and Reconnect after a detach.
