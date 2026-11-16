# Travel Planner states (stage-travel.mjs)

`node scripts/demo/launch/tools/stage-travel.mjs [desktop|mobile] [--only a,b] [--seed] [--down]`.
Instance: http://localhost:3140 (data/verify/travel/), left running in the mobile end state.
Owner `demo@example.com` shows as "Ashik"; guest `sonaal@example.com` (password = email) is "Sonaal".

## How it is staged

- **Stand-in sandbox VM (real):** this machine, as setup-vm.sh did it: sshd on 127.0.0.1:2240 for
  user `travelvm` (keys/config in data/verify/travel-vm/), Chrome + Xtigervnc + XFCE. That Chrome
  maps `flights.example.com` to `tools/travel-flights.mjs` (127.0.0.1:3145, self-signed key it trusts).
  So the browser, VNC stream, take-control and computer are the app's real ones.
- **Clock:** the server runs ~3-4 h ahead (`travel-register.mjs`) so it boots just before 7:00 AM
  IST and the daily `Morning fare check` routine (cron `0 7 * * *`, IST) fires on schedule. Browsers
  use TZ Asia/Kolkata and `page.clock` set to the server's time (so "Expires in N minutes" is right).
- **Fake model:** `travel-director.mjs` (wired by `travel-hooks.mjs`). Routine run: `browser_navigate`
  to the fares page, then CAST line 2. Chat: CAST line 2 + `browser_fill_secret {handle: visa}`.
- **Fill fix:** under tsx, esbuild keepNames puts `__name(...)` into the in-page fill function, so the
  fill always failed ("No matching field", red row). The sample page defines `window.__name`.
- **HMR:** Vite reloads the page whenever any helper writes a file into the repo. An init script points
  only the HMR socket (port 3141) at a closed port. Playwright's routeWebSocket breaks noVNC.
- **Only DOM edit:** the owner message that starts the booking turn (`Book the Friday 6:15 fare for
  two.`, not in CAST) gets `hidden` on its `[data-message-id]` row before every snapshot.

## States (desktop / mobile verify)

| State | Shows | Staged | desktop | mobile |
| --- | --- | --- | --- | --- |
| travel-waiting | routine line, CAST msg 2, waiting vault card | real flow + edit | 0.00192 | 0.03738* |
| travel-live | panel, Browser tab, view-only, "Click to take control" (desktop: hovered) | real | 0.37362† | 0.00005 |
| travel-driving | after take control: green frame, "You're driving", Hand back | real | 0.00241 | 0.00022 |
| travel-computer | Computer tab, real XFCE desktop live | real | 0.03978‡ | 0.04456‡ |
| travel-approved | card approved: grey done row "Filled a saved login “visa”" | real | 0.00000 | 0.02436* |
| travel-shared-ashik | CAST step 4, Ashik's view (Sonaal's name above her bubble) | real | 0.00039 | 0.03484* |
| travel-shared-sonaal | same moment, Sonaal signed in as guest (Ashik's name shown) | real | 0.00192 | 0.03329* |

\* Mobile chat states: the chat scroller has `scrollbar-gutter: stable`. The phone emulation has overlay
scrollbars; verify's 1920 page has classic ones, so the embed is 10 px narrower and text rewraps. With
`*{scrollbar-width:none}` in the embed page it matches. The film's mobile frames need that rule.
† The pill is `opacity-0 group-hover:opacity-100`; hover cannot live in static markup. The film must
show the pill itself (mobile shows it always, `pointer-coarse:opacity-100`).
‡ Stream canvas resampling on the busy wallpaper; chrome around it matches.

## Selectors

- Routine-run line: `[data-testid="routine-runs"]` (its button: `aria-expanded`, title "… 07:00 IST").
- Vault card: `[data-waiting^="approval:"] [data-slot="item"]`, text "Travel Planner wants to fill
  Visa ••4242 on https://flights.example.com"; Approve: `getByRole("button", {name: "Approve once"})`
  (also "Deny"). Approved: the tool row with text `Filled a saved login “visa”`.
- Live view toggle: `[data-testid="live-view-toggle"]`. Panel: `[data-testid="browser-panel"]` /
  `[data-testid="computer-panel"]`. Tabs: `[role="tablist"][aria-label="Live view"]`,
  `[data-testid="live-view-tab-browser"]`, `[data-testid="live-view-tab-computer"]`.
- Stream area: `[data-testid="browser-viewport"]` (its noVNC `<canvas>` fills it; baked to an `<img>` in
  the snapshot). Desktop: x 672, y 52, 600x660 (canvas 600x660 px). Mobile: x 0, y 44, 390x800 (canvas
  500x1025 px scaled down). Computer: `[data-testid="computer-viewport"]`, same box.
- Take control: `[data-testid="browser-takeover"]` (button, aria-label "Take control"; pill text "Click
  to take control"). Driving: `[data-testid="browser-driving-frame"]`, `getByRole("button", {name: "Hand back"})`.
- Shared sender: message rows carry `data-author="Ashik"|"Sonaal"`.
