# Cast and sample data

Every screen in the film uses this data, word for word. It is sample data: the
people, fares, flights, test counts, cost line and card number are made up.

## People

- **Ashik**: the owner (the signed-in user; show the name "Ashik" wherever the app shows the account name).
- **Sonaal**: a guest. The Travel Planner bot is shared with Sonaal.

## Bots, in sidebar order at the start (most recent first)

| Bot            | Description                   | Sidebar state at the start      |
| -------------- | ----------------------------- | ------------------------------- |
| Code Buddy     | Fixes bugs and ships code     | unread                          |
| Travel Planner | Plans trips and watches fares | waiting on the owner (approval) |
| Chief of Staff | Runs the team                 | waiting on the owner (approval) |
| Researcher     | Digs through the web          | read; this is the open chat     |

Expense Tracker ("Logs receipts and totals your spend") does not exist at the
start. Chief of Staff creates it during the film; in the end state it is the
newest bot and nothing is unread or waiting.

## Chats

### Code Buddy

1. Ashik: `The checkout test is flaky. Fix it and run the suite.`
2. Code Buddy hands off to Claude Code (the code hand-off tool row or card), working directory `~/code/shop`.
3. The hand-off's finish arrives in the chat the way the app delivers it (for example "Reply from …"): `Fixed the flaky checkout test. The cart total was read before the price fetch resolved, so the test now awaits it. All 48 tests pass.`
4. Code Buddy: `Fixed. All 48 tests pass. The change is on branch fix/checkout-flake.`

### The Code thread (Claude Code harness), title `Fix flaky checkout test`, directory `~/code/shop`

1. Prompt: `The checkout test is flaky. Fix it and run the suite.`
2. Bash `pnpm test checkout` → exit code 1, output ending:
   ```
    FAIL  tests/checkout.test.ts > checkout > shows the cart total
   AssertionError: expected '₹0' to be '₹1,499'
    Test Files  1 failed (1)
         Tests  1 failed | 5 passed (6)
   ```
3. Edit `tests/checkout.test.ts`, diff:
   ```diff
   -    render(<Checkout />);
   -    expect(screen.getByTestId("total")).toHaveTextContent("₹1,499");
   +    render(<Checkout />);
   +    await screen.findByText("Price loaded");
   +    expect(screen.getByTestId("total")).toHaveTextContent("₹1,499");
   ```
4. Bash `pnpm test` → exit code 0, output ending:
   ```
    Test Files  9 passed (9)
         Tests  48 passed (48)
   ```
5. Assistant text: `Fixed the flaky checkout test. The cart total was read before the price fetch resolved, so the test now awaits it. All 48 tests pass.`
6. Turn footer: `Worked for 2m 14s · $0.31`

### Travel Planner (shared with Sonaal)

1. A routine run, routine name `Morning fare check`, daily at 7:00 AM, prompt `Check Chennai to Goa fares for Friday.`
2. Travel Planner: `Goa fares dropped ₹4,200. The 6:15 AM nonstop on Friday is ₹5,840, under your ₹6,000 limit, so I'm booking two seats.`
3. A waiting vault approval card: Travel Planner wants to fill the card `Visa ••4242` on `flights.example.com`.
4. Later (after approval), the shared conversation:
   - Ashik: `Sonaal, we're booked for Friday 6:15!`
   - Sonaal: `Yes!! Window seats please?`
   - Travel Planner: `Done. You're in 14A and 14B.`

The page in Travel Planner's browser is `https://flights.example.com/search?from=MAA&to=GOI`
(a sample fare-results page; nobody needs to build it for the snapshots).

### Chief of Staff

1. Ashik: `Make me an Expense Tracker bot. Log receipts I send it.`
2. Chief of Staff: `Expense Tracker is ready for your OK.`
3. A waiting `create_bot` approval card:
   - name `Expense Tracker`
   - description `Logs receipts and totals your spend`
   - model: none given (the card shows the default model)
   - instructions: `You are Expense Tracker. When Ashik sends a receipt photo or an amount, record the date, merchant, amount and category. Reply with the running total for the month. Ask before you change or delete an entry.`
4. After approval, Chief of Staff: `Expense Tracker has joined the team. Send it a receipt to try it.`

### Researcher (the open chat at the start)

1. Ashik: `Find beach hostels in Goa under ₹1,500 a night.`
2. Researcher: `Your report is ready. Three areas fit the budget:` then a short list:
   - `Palolem: quiet beach, ₹900 to ₹1,400`
   - `Anjuna: lively, ₹700 to ₹1,200`
   - `Arambol: long stays, ₹600 to ₹1,100`

## Montage screens

- **Memory:** `Prefers window seats`, `Flight budget: under ₹6,000 one way`, `Travels with Sonaal`, `Works in the ~/code/shop repo`.
- **Connections (MCP):** three connected servers named `GitHub`, `Linear` and `Google Calendar`.
- **Models:** provider accounts `Anthropic · Work`, `OpenAI`, `Ollama (local)` and a Claude plan account, each with one or two models.
- **YOLO:** the Researcher chat with YOLO on: the banner, and tool rows marked `auto-approved (YOLO)`.
- **Updates:** Settings → Updates with a newer version available and the `Update & restart` button.
- **Terminal:** the sandbox terminal page after `pnpm test`, showing `Tests  48 passed (48)`.
