---
format: 1920x1080
duration: 76s
message: "Your bots do real work while you're away, and ask before anything that matters"
arc: Inbox hook → Name → 5 use-case beats → And more → Inbox, all read → End card
audience: developers and tinkerers who would self-host a personal AI team
fps: 30
bpm: 120 (one bar = 2.0 s; every cut lands on a downbeat)
storyline: A. The inbox (see STORYLINES.md)
---

# tiny-agents product demo

One evening, one person catching up. The bot list is the home screen: the film
opens on it full of finished work, opens each bot in turn to show how the job got
done, and returns to it between beats. Each return shows one more row read.

Second revision. The first board was a tour of what shipped since the last film.
This one covers the whole product and has a spine.

## What changed from the first board

| First board | This board |
| --- | --- |
| Six unrelated mini-demos, each with its own sample data | One evening, one bot list, four bots whose jobs connect |
| Hook was one line of reply text | Hook is four finished jobs landing in two seconds |
| Only features newer than the last film | The strongest use cases of the whole product: routines, the bot's browser and the Vault are back |
| YOLO mode had its own 9 s scene | One shot in the montage; "it asks first" is the stronger trust story |
| Dark ground, like the last film | The app's light theme on the site's white, which reads better at size; the end card is dark |

Kept from the earlier films, because it's the product's own: the logo, Inter and
JetBrains Mono, monochrome with green for done and amber for waiting, the tagline,
the scripted fake-model recorder for real captures, and a code-generated score.

## Look

- **Home screen:** the app window at 88% of frame width on white `#ffffff` with a
  `#f6f6f7` ground; ink `#1f1f23`, muted `#6f6f7a`, line `#e6e6ea`.
- **Punch-ins:** 1.6 to 2.0x onto the one control the cursor needs; moves take
  0.5 s, then hold while the UI acts. No UI text under 26 px after a push.
- **Captions:** Inter Display 700, 72 px, -0.04em, ink on white, top of frame, one
  line at a time, at most 6 words.
- **Colour:** green `#2f8a5b` only for done or passing; amber `#b45309` only for
  something waiting on you.
- **End card:** flips to the brand near-black `#0c0b0a` with the white mark.
- **Banned:** a title over a dimmed screenshot, three cards in a row, a docked
  logo, a small window floating in an empty frame, UI tilted in 3D, glow.

## The cast (sample data, used in every beat)

| Bot | Its job in the film |
| --- | --- |
| Code Buddy | Fixed the flaky checkout test through Claude Code |
| Travel Planner | Checks Chennai to Goa fares every morning; found a drop; wants to book |
| Chief of Staff | Asked to make an Expense Tracker bot |
| Expense Tracker | The new bot; appears in the list during the film |

People: Maya (the owner) and Sam (her guest in the Goa chat).

## Frame 1: The inbox

- duration: 4s (0.0 to 4.0)
- transition_in: cut. Frame 0 is the thumbnail: the bot list with two previews already unread
- scene: The bot list at 1.7x. Two more previews land with a pop each, so four rows are unread: Code Buddy "Fixed the flaky checkout test. 48 passing." · Travel Planner "Goa fares dropped ₹4,200." with the amber waiting mark · Chief of Staff "Expense Tracker is ready for your OK." · Researcher "Your report is ready."
- caption: "While you were out"
- reads: the previews (0.0 to 2.0 s); the caption (1.4 to 4.0 s)
- sound: the bed starts on a hit; a pop per preview

## Frame 2: The name

- duration: 2s (4.0 to 6.0)
- transition_in: the camera pulls back from the list to the whole app window
- scene: The full app: bot list on the left, an open chat on the right.
- caption: eyebrow "TINY AGENTS", headline "A team of AI bots"
- sound: a short rise into the first beat

## Frame 3: Hand off the bug

- duration: 14s (6.0 to 20.0)
- transition_in: the cursor clicks the Code Buddy row; the row opens into its chat
- scene: Maya's earlier message is already there: "The checkout test is flaky. Fix it and run the suite." Under it, a tool row for the hand-off to Claude Code. The cursor clicks it and the row grows into the full-page **Code** workspace. The transcript plays fast: `pnpm test checkout` fails red; an edit row opens its +/− diff (pushed in at 1.8x); the test re-runs green, "48 passed"; the turn ends "Worked for 2m 14s · $0.31". The thread shrinks back into the chat as "Reply from Claude Code: …".
- captions: "Hand off the bug" (6.0 to 9.5) → "It codes on your sandbox" (10.0 to 14.5) → "Tests pass. It reports back." (15.0 to 20.0)
- reads: the message (6.5 to 9.0); red fail (10.0 to 11.5); the diff (11.5 to 14.5); green pass and cost (15.0 to 18.0); the reply (18.0 to 20.0)
- sound: a click; a whoosh on the grow; a low thud on red; a bright tick on green

## Frame 4: It browses for you

- duration: 12s (20.0 to 32.0)
- transition_in: back to the list (Code Buddy now read); the cursor clicks Travel Planner
- scene: The chat shows a routine run from 7:00 AM: "Check Chennai to Goa fares". The live view panel opens beside the chat with the bot's own browser on a fare results page; the bot's cursor sorts by price and picks one. Maya's cursor hovers the stream, which reads "Click to take control"; she clicks, the status flips to driving, and she scrolls to check the baggage line herself.
- captions: "Runs every morning at 7" (20.0 to 23.5) → "In its own browser" (24.0 to 27.5) → "Take the wheel anytime" (28.0 to 32.0)
- sound: a soft tick on the routine line; a click on take control

## Frame 5: It asks before it pays

- duration: 10s (32.0 to 42.0)
- transition_in: an amber card rises in the chat and shrinks into a phone push as the phone slides in
- scene: An Android phone at 72% of frame height on the light ground. Lock screen push: "Travel Planner needs your approval". A tap opens the Tiny Agents Android app on that chat, scrolled to the card: "Travel Planner wants to fill Visa ••4242 on …" with the line "The value goes straight into the page; Travel Planner never sees it." A tap on Approve; the card settles to approved.
- captions: "It asks before it pays" (32.0 to 35.0) → "Approve from your phone" (35.5 to 38.5) → "Your card stays in the Vault" (39.0 to 42.0)
- sound: a phone buzz; a tap; a chime on Approve

## Frame 6: Hire a new bot

- duration: 9s (42.0 to 51.0)
- transition_in: the phone slides out; back to the list; the cursor clicks Chief of Staff
- scene: Maya's message: "Make me an Expense Tracker bot. Log receipts I send it." An amber card: "Chief of Staff wants to create a new bot: “Expense Tracker”" with its description, model and instructions (pushed in at 1.8x). The cursor clicks Approve. The camera follows a new avatar as it drops into the bot list: Expense Tracker, online.
- captions: "Need a new teammate? Ask." (42.0 to 45.5) → "You approve. It joins the team." (46.5 to 51.0)
- sound: a click and a chime; a soft pop as the row lands

## Frame 7: Bring a friend in

- duration: 8s (51.0 to 59.0)
- transition_in: the cursor reopens Travel Planner; a second app window slides in from the right
- scene: Two windows, Maya's and Sam's, on the same chat. Maya sends "Sam, the 6:15 flight works?" and it appears in both at once under her name. Sam answers "Yes! Book it." The bot replies once, in both windows. Sam's window slides away.
- captions: "Bring a friend into the chat" (51.0 to 54.5) → "One chat, everyone live" (55.0 to 59.0)
- sound: two message pops, panned left and right

## Frame 8: And more

- duration: 8s (59.0 to 67.0)
- transition_in: cut on the bar
- scene: Six real screens, 1.3 s each, cut on the beat, each a push-in on one control: a remembered fact in Memory; the sandbox Terminal running a command; Connections (MCP servers); Settings → Models with its provider kinds; the YOLO banner "YOLO on: tools run without asking (vault items still ask)"; Settings → Updates with "Update & restart".
- captions: eyebrow "AND MORE", one label per shot: "Remembers you" · "A real terminal" · "Your tools, connected" · "Any model" · "Or let it run" · "Updates itself"
- sound: a hat on each cut

## Frame 9: All read

- duration: 4s (67.0 to 71.0)
- transition_in: cut back to the bot list
- scene: The same list as frame 1, now with five bots and nothing unread. The last unread dot clears as the shot starts.
- caption: "They work. You stay in charge."
- sound: the bed drops to a held chord

## Frame 10: End card

- duration: 5s (71.0 to 76.0)
- transition_in: the cursor clicks the logo mark at the top of the sidebar; the mark lifts to centre as the ground turns near-black
- scene: The mark centred at 18% of frame width, a fill rising through it. "Tiny Agents" wipes in beside it; the tagline lands; then a "Star on GitHub" button and `github.com/AshikNesin/tiny-agents`. Hold 2.5 s.
- captions: "Tiny Agents" / "Your team of always-on AI agents." / the link
- sound: the final chord resolves on the mark

# Cut-downs

## Vertical (1080x1920, about 56 s)

Rebuilt, not cropped. The home screen is the web app's real phone layout, where
the bot list already fills a phone screen (390 px wide, scaled 2.6x). Every word
and the product sit between 168 px and 1330 px. Captions are 1.35x larger, at
most 5 words. Frames run 3 / 2 / 10 / 9 / 8 / 7 / 6 / 5 / 3 / 3 s; the Code
transcript and the live view stack under the chat instead of beside it; the
montage keeps four shots.

## X teaser (1920x1080, 15 s)

Inbox hook (0 to 3) → Hand off the bug (3 to 7.5) → Approve from your phone
(7.5 to 11) → All read and end card (11 to 15). The same scene files, re-timed.

# Sourcing: real, rebuilt, or sample

| What | Source |
| --- | --- |
| Bot list, chats, approval cards, bot builder card, shared chat, Memory, Connections, Models, Updates, YOLO banner | The real app in a throwaway instance (`verify-tiny-agents`), driven by the scripted fake model, captured and rebuilt at 1.6 to 2x with the real labels |
| Code page transcript | Rebuilt from the real `/code` components. A live Claude Code run needs a signed-in Claude account, which this container doesn't have |
| Live view and Terminal contents | The real panel and its "Click to take control" control. What's inside the stream is a still of a sample page, because no sandbox VM or container can run here |
| Android app and the push | Rebuilt from the `mobile/` Compose source and its design doc. There's no emulator here |
| Bot names, messages, fares, test counts, the cost line, the card number | Sample data |

# Sound

An original, royalty-free score generated in numpy at 120 BPM, mastered to
-16 LUFS, on one `<audio id="music">` slot (`assets/music.wav`) so another track
can replace it without touching a scene. Pops, clicks, the buzz and chimes are
generated the same way and sit on the visible actions.
