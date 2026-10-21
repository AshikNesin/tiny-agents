---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Browser panel: full screen now fills the screen, and the panel has a new look.
The bot's connection to Chrome on the VM used to drop silently after about a
minute of idle (the local CDP forwarder was an HTTP server, and its 60 s header
timeout cut the WebSocket). Resizing then did nothing while the session still
looked open, so a window expanded after a pause stayed at its old size in one
corner of the canvas. The forwarder is now a plain TCP relay, a browser that
dies is dropped (the panel shows Closed instead of a frozen view, and the
bot's next browser tool call opens a fresh one), and `POST /browser/resize`
answers 502 when it cannot resize instead of 200 with nothing done. The viewer
sends one resize at a time, refits to the latest panel size afterwards, and
retries a failed fit twice. Fitting the Chrome window now takes one round trip
to the VM instead of four, so the window keeps up with the screen when you
enter or leave full screen, and a panel narrower than Chrome's 500 px minimum
window (the 360 px panel, a phone) shows the whole window scaled down instead
of cropped. The panel is now a card with a title, a live status line (Live,
Connecting, Reconnecting, Headless, Closed) with who is driving and the URL,
labelled Paste and Full screen buttons, Take control and Release control in
the header, a header that collapses to icons when narrow, and empty, starting
and failed states that match the rest of the app.
