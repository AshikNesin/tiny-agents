---
format: 1920x1080
duration: 76s
message: "Your bots do real work while you're away, and ask before anything that matters"
arc: Inbox hook → Name → 5 use-case beats → And more → Inbox, all read → End card
audience: developers and tinkerers who would self-host a personal AI team
fps: 30
bpm: 120 (one bar = 2.0 s; every cut between scenes is on a beat, and the mark lands on a bar line)
storyline: A. The inbox (see STORYLINES.md)
---

# tiny-agents product demo

One evening, one person catching up. The bot list is the home screen: the film
opens on it full of finished work, opens each bot in turn to show how the job
got done, and comes back to it. This is the storyboard as built. `SPEC.md` has
the numbers, `CAST.md` the sample data, `REVIEW.md` what was checked.

Times are film seconds. Each frame names the scene file that holds it
(`src/scenes/`); two pairs of frames share a file because they share a screen.

## Frame 1: The inbox

- src: src/scenes/s01-open.html
- duration: 3s (0.0 to 3.0)
- status: animated
- transition_in: cut. Frame 0 is the thumbnail: the bot list with two rows already there
- scene: The app's bot list alone, as a tall panel. Travel Planner's row lands with its waiting count, then Code Buddy's with its unread dot: "Fixed. All 48 tests pass.", "Goa fares dropped ₹4,200.", "Expense Tracker is ready…", "Your report is ready."
- caption: "While you were out"
- reads: the caption (0.1 to 2.9 s); the four previews (0.6 to 3.0 s)
- sound: the bed starts on a soft hit; a pop as each row lands

## Frame 2: The name

- src: src/scenes/s01-open.html
- duration: 3s (3.0 to 6.0)
- status: animated
- transition_in: the panel widens into the whole app window as the camera pulls back
- scene: The full app: the list is the sidebar; Researcher's finished report is the open chat. The pointer comes in and stops on Code Buddy.
- caption: eyebrow "TINY AGENTS", headline "A team of AI bots"
- reads: the headline (3.4 to 5.7 s)
- sound: a whoosh on the widening

## Frame 3: Hand off the bug

- src: src/scenes/s02-code.html
- duration: 14s (6.0 to 20.0)
- status: animated
- transition_in: a click on Code Buddy's row opens its chat
- scene: The chat: "The checkout test is flaky. Fix it and run the suite.", the hand-off card for Claude Code, and the answer below. A click on "Open in Code" grows the card into the Code workspace, on the thread it started. The transcript is walked through: `pnpm test checkout` fails in red; the edit's diff; `pnpm test` passes, 48 of 48; the agent's summary and "Worked for 2m 14s · $0.31". The workspace shrinks back into the card, and the camera closes on the summary that was relayed into the chat.
- captions: "Hand off the bug" (6.5 to 9.3) → "It codes on your sandbox" (10.2 to 14.2) → "Tests pass. It reports back." (14.6 to 19.5)
- sound: clicks; a whoosh on the card opening and closing; a low thud on the failed run; a tick on the passing run

## Frame 4: It browses for you

- src: src/scenes/s03-browse.html
- duration: 12s (20.0 to 32.0)
- status: animated
- transition_in: a click on Travel Planner's row
- scene: The chat shows the routine run "Morning fare check · done · 07:00", the bot's message about the fare, and a waiting card. A click on the live view button opens the bot's own browser beside the chat: a real Chrome on the fare page, "Travel Planner is driving". The pointer hovers the stream, "Click to take control" appears, and a click turns the panel to "You're driving" with "Hand back" beside it. The view closes and the camera settles on the waiting card.
- captions: "Runs every morning at 7" (20.9 to 23.5) → "In its own browser" (24.2 to 27.3) → "Take the wheel anytime" (27.5 to 31.5)
- sound: clicks; a pop as the panel opens; a tick on taking control

## Frame 5: It asks before it pays

- src: src/scenes/s04-phone.html
- duration: 10s (32.0 to 42.0)
- status: animated
- transition_in: the camera is already on the card: "Travel Planner wants to fill Visa ••4242 on https://flights.example.com", "The value goes straight into the page; Travel Planner never sees it."
- scene: The desk slides away and an Android phone rises on a warm ground. The push lands on the lock screen: "Travel Planner needs approval". A tap opens the Tiny Agents Android app on that chat, at the same card. A tap on Approve; the card settles into one line, "Filled a saved login “visa” · 1.2s · waited 9s for you". The phone drops away and the desk returns, settled too.
- captions: "It asks before it pays" (32.2 to 34.1) → "Approve from your phone" (34.6 to 37.3) → "Your card stays in the Vault" (37.6 to 41.5)
- sound: a whoosh as the desk leaves; a phone buzz; two taps; a soft bell on Approve

## Frame 6: Hire a new bot

- src: src/scenes/s05-hire.html
- duration: 9s (42.0 to 51.0)
- status: animated
- transition_in: a click on Chief of Staff's row
- scene: "Make me an Expense Tracker bot. Log receipts I send it." and the card "Chief of Staff wants to create a new bot: “Expense Tracker”" with its description and model. The camera closes on the card; a click on Approve. The card becomes "Created bot “Expense Tracker”" and the bot says it has joined the team. The screen narrows to the bot list again, and Expense Tracker's row lands in it.
- captions: "Need a new teammate? Ask." (42.8 to 45.5) → "You approve. It joins the team." (46.4 to 50.5)
- sound: clicks; a soft bell on Approve; a pop as the row lands

## Frame 7: Bring a friend in

- src: src/scenes/s06-friend.html
- duration: 7s (51.0 to 58.0)
- status: animated
- transition_in: a click on Travel Planner's row
- scene: Ashik types "Sonaal, we're booked for Friday 6:15!" and sends it. The screen splits in two, Ashik's window above and Sonaal's below, on the same chat: the message is in both. Sonaal's "Yes!! Window seats please?" arrives in both at once, then the bot answers once, for both: "Done. You're in 14A and 14B."
- captions: "Bring a friend into the chat" (51.7 to 54.2) → "One chat, everyone live" (54.5 to 57.8)
- sound: typing; a click; pops panned to each side

## Frame 8: And more

- src: src/scenes/s07-more.html
- duration: 9s (58.0 to 67.0)
- status: animated
- transition_in: cut on the beat
- scene: Six shots of 1.5 s, hard cuts, each cutting in a little wide and settling on one control: Memory's saved facts; the sandbox terminal after `pnpm test`; Connections with three MCP servers; Settings → Models with its provider accounts; a chat with "YOLO on: tools run without asking (vault items still ask)" and rows marked auto-approved; Settings → Updates with "Update & restart".
- captions: eyebrow "AND MORE"; "Remembers you" · "A real terminal" · "Your tools, connected" · "Any model" · "Or let it run" · "Updates itself"
- sound: a hat on each cut

## Frame 9: All read

- src: src/scenes/s08-close.html
- duration: 4.2s (67.0 to 71.2)
- status: animated
- transition_in: cut back to the bot list panel
- scene: The list as the film opened on it, now five bots. Expense Tracker's unread dot clears; nothing is waiting. The camera rises to the top of the sidebar and the pointer clicks the app's mark.
- caption: "They work. You stay in charge."
- reads: the caption (67.4 to 70.9 s)
- sound: the bed drops to pads only

## Frame 10: End card

- src: src/scenes/s08-close.html
- duration: 4.8s (71.2 to 76.0)
- status: animated
- transition_in: the click floods the frame near-black from the mark, and the mark lifts out of the sidebar to the centre, landing at 72.0
- scene: The mark, then "Tiny Agents" wiping in beside it, the tagline, a "Star on GitHub" button and the repository's address. The pointer clicks the button and its star fills. Held to the end.
- captions: "Tiny Agents" / "Your team of always-on AI agents." / "Star on GitHub" / `github.com/AshikNesin/tiny-agents`
- sound: an impact on the bar line as the mark lands; the chord rings out

# Cut-downs

## Vertical (1080x1920, 57 s)

Rebuilt on the app's phone layout, not cropped: `src/scenes/v/`. The bot list
is the phone's own Chats screen; a tap opens a chat and screens slide. Every
word and control sits between y 168 and y 1330, clear of a platform's own UI.
Scenes run 5 / 10 / 9 / 8 / 7 / 6 / 6 / 6 s, and the montage keeps four shots.

## Teaser (1920x1080, 15 s)

Four stretches of the same scenes, re-timed (`src/cuts.mjs`): the inbox hook
(0 to 3), the hand-off from the click to the passing tests (3 to 7.5), the
phone from the push to the approval (7.5 to 11), and the close from the click
on the mark (11 to 15).

# What is real

Everything inside the film's screen is the app's own markup and stylesheet,
saved from a running instance (`snap/`, with notes per state). The phone's chat
screens are renders of the Android app's own UI code. See `REVIEW.md` for what
was stood in for and why.

# Sound

An original score generated in code at 120 BPM (`tools/music.py`), mastered
under the picture, with a separate effects stem placed from the scenes' own
cues: `assets/audio/music.<cut>.wav` and `sfx.<cut>.wav`. Either can be
replaced without touching a scene.
