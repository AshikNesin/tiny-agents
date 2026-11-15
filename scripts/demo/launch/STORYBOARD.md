---
format: 1920x1080
duration: 78s
message: "Your bots now code, hire, and ask from your pocket"
arc: Hook → Reveal → 6 use-case beats → And more → End card
audience: developers and tinkerers who self-host their own AI assistant
fps: 30
bpm: 120 (one bar = 2.0 s; every cut lands on a downbeat)
device: The result first, then how it got there
form: Object-to-object chain (each beat ends on the thing that opens the next)
---

# tiny-agents launch film (November 2026)

The one thing a viewer remembers: **"My bots do real work, and I stay in control from anywhere."**

One carrier runs through the film: a chat message or card becomes the next scene.
The chain goes reply, Code thread, approval card, phone push, live view, shared chat,
YOLO banner, then the logo.

## Look

- **Desktop world:** the real web app in its light theme, filling 85% or more of the
  frame on the brand ground `#0c0b0a`. Punch-ins run at 1.6 to 2.0x on the control
  the cursor needs. Window radius 22 px; shadow 0 50 px 120 px at 0.75.
- **Phone world (beat 3 only):** a warm paper ground `#ece9e4`, with the Android
  phone at 70% of frame height.
- **Type:** Inter Display 700 for captions (72 px, -0.04em). Eyebrows are Inter
  650, 22 px, +0.16em, upper case, `#a39f98`. JetBrains Mono for commands.
- **Colour:** monochrome. Green only for live or passing, amber only for an
  approval waiting.
- **Banned (beyond HyperFrames defaults):** a title over a dimmed screenshot,
  three cards in a row, a docked logo, a small window floating in a void, and
  product UI tilted in 3D.

## Sourcing (real or recreated)

| Beat | Source |
| --- | --- |
| Chat, bot builder card, YOLO, shared chat, Settings screens | The real app (`verify-tiny-agents`: isolated instance, faux model driven by a scripted director), captured and rebuilt at 1.6 to 2x with the real labels |
| Code page transcript | Rebuilt from the real `/code` components and labels. A live Claude Code run needs a signed-in Claude account, which this container doesn't have |
| Android app | Rebuilt from `mobile/` Compose source and `mobile/docs/design/DESIGN.md`. There's no emulator here |
| Live view stream | The real live-view frame ("Click to take control") around a page the bot browses. The stream content is a capture, not a VNC recording |

## Frame 1: Hook

- duration: 3s (0.0 to 3.0)
- transition_in: cut (frame 0 is the thumbnail and is already busy)
- scene: Pushed in at 1.8x on a chat reply arriving: "Reply from Claude Code: Fixed the flaky checkout test. All 48 tests pass." The green pass check ticks on.
- caption: "Fixed while you were at lunch"
- reads: the reply text streams in (0.0 to 1.4 s); the caption lands (1.2 to 3.0 s)
- sound: the bed enters on a hit; a soft tick on the green check

## Frame 2: Reveal

- duration: 3s (3.0 to 6.0)
- transition_in: camera pull-back from the reply to the whole app window
- scene: The pull-back reveals the real sidebar of bots (Code Buddy, Chief of Staff, Researcher, Writer…), each online dot lighting in a stagger.
- caption: eyebrow "TINY AGENTS" with headline "Your always-on AI team"
- sound: rising swell into the first beat

## Frame 3: Hand off the coding

- duration: 12s (6.0 to 18.0)
- transition_in: the camera pushes into Code Buddy's composer
- scene: The prompt types: "The checkout test is flaky. Fix it and run the suite." A code tool row appears, and the row morphs into the full-page **Code** workspace. The transcript plays: a bash row `pnpm test checkout` fails red, an edit row shows a +/− diff (punched in), the bash row re-runs green ("48 passed"), and the turn ends "Worked for 2m 14s · $0.31". The thread morphs back into the chat as "Reply from …".
- captions: "Hand off the coding" (6.0 to 9.0) → "It codes in your sandbox" (9.5 to 13.5) → "Reports back when it's done" (14.0 to 18.0)
- sound: typing ticks; a whoosh on the morph; a low thud on the red fail; a bright tick on green

## Frame 4: Bots that build bots

- duration: 10s (18.0 to 28.0)
- transition_in: cut on the bar to Chief of Staff's chat
- scene: The prompt types: "Make me a Travel Planner bot. Window seats, mid-range hotels." An amber approval card arrives, "Chief of Staff wants to create a new bot: “Travel Planner”", listing Description, Model and Instructions (Read more). Punch in at 1.8x. The cursor clicks **Approve**, then the camera follows the new bot's avatar dropping into the sidebar.
- captions: "Need a new teammate? Ask." → "You approve every new bot" → "Ready in your sidebar"
- sound: a click and a chime on Approve; a soft pop when the avatar lands

## Frame 5: Approve from your pocket

- duration: 10s (28.0 to 38.0)
- transition_in: the next amber card lifts out of the desktop and shrinks into a push notification (world change: paper ground)
- scene: An Android phone at 70% height shows the lock screen push "Travel Planner needs your approval". A thumb taps it, and the Tiny Agents Android app opens on that bot's chat, scrolled to the waiting card. The thumb taps Approve and the card settles to approved.
- captions: "Away from your desk?" → "Approve from your phone"
- sound: phone buzz; a tap; a chime

## Frame 6: Watch, then take the wheel

- duration: 10s (38.0 to 48.0)
- transition_in: the phone screen zooms through to the desktop's live view panel (Browser | Computer tabs)
- scene: The bot's browser streams live and its cursor works on a page. Our cursor hovers, the whole stream reads "Click to take control", the click switches the status to driving, and the cursor scrolls and clicks. A tab switch to Computer shows the same page in the desktop's Chrome (one shared profile).
- captions: "Watch it work, live" → "Click to take the wheel"
- sound: a soft room tone under the stream; a click

## Frame 7: Bring a friend

- duration: 9s (48.0 to 57.0)
- transition_in: split screen. The live view slides left and a second window slides in from the right
- scene: Two browser windows, Maya's and Sam's, show the same Travel Planner chat. Maya types "@Travel Planner Goa for the two of us, under ₹40k?" and it appears in both windows at once, with her name. Sam adds "Beach hostel is fine!". The bot answers once, visible in both. The split collapses to one window.
- captions: "Bring a friend into the chat" → "One chat, everyone live"
- sound: two message pops, panned left and right

## Frame 8: YOLO, safely

- duration: 9s (57.0 to 66.0)
- transition_in: the cursor clicks the bot's name in the chat header and the menu opens
- scene: The cursor clicks the **YOLO mode** row and confirms. A banner punches in: "YOLO on: tools run without asking (vault items still ask)". Tool rows tick by with "auto-approved (YOLO)". Then an amber vault card still appears and waits.
- captions: "Trust this chat? Go YOLO" → "Your secrets still ask first"
- sound: the rows tick fast; the music drops to a held note on the vault card

## Frame 9: And more

- duration: 7s (66.0 to 73.0)
- transition_in: cut on the bar
- scene: Six real screens at about 1.1 s each, cut on half bars, each a punch-in on one control: Settings → Models (provider kinds incl. Claude plan); Settings → Updates "Update & restart"; Code → Changes diff cards; the context-ring usage popup; the "wants to update its instructions" card; the first-run `/setup` page.
- captions: eyebrow "AND MORE", plus one label per shot: "Any model" · "One-click updates" · "Review every change" · "Usage and cost" · "Bots refine themselves" · "Guided first run"
- sound: a hat on each cut

## Frame 10: End card

- duration: 5s (73.0 to 78.0)
- transition_in: the cursor clicks the logo mark at the top of the app's rail; the mark lifts to centre as the app falls away
- scene: The mark sits centred at 18% of frame width while a fill rises through it. "Tiny Agents" wipes in beside it, the tagline follows, then a real button "Star on GitHub" and `github.com/AshikNesin/tiny-agents`. Hold 2.5 s.
- captions: "Tiny Agents" / "Your team of always-on AI agents." / CTA
- sound: the final chord resolves on the mark

# Cut-downs

## Vertical (1080x1920, about 60 s)

The same story, recomposed rather than cropped. The web app is shown in its **real phone layout** (390 px wide, scaled 2.6x), which fills the vertical frame. Every word and the product sit between 168 px and 1330 px. Captions are 1.35x larger, at most 5 words. Beats shorten to 8 s each with 1 to 2 s shots, and the montage drops to 4 shots.

## X teaser (1920x1080, 15 s)

Hook (0 to 2.5) → Hand off the coding (2.5 to 6.0) → Bots build bots (6.0 to 9.0) → Approve from your phone (9.0 to 12.0) → End card (12.0 to 15.0). These are the same compositions re-timed, not new scenes.

# Sound

An original, royalty-free score synthesised in numpy (the same approach as the previous films' `music.py`) at 120 BPM, mastered to -16 LUFS. It's one `<audio id="music">` slot pointing at `assets/music.wav`, so a licensed track can replace it without touching any scene. UI effects (clicks, ticks, buzz, whoosh) are synthesised too.
