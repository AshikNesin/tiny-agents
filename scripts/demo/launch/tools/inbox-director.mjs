// Scripts the fake model for the inbox staging instance: each CAST.md owner
// message gets the CAST.md reply, with real tool calls where the cast has an
// approval card. Anything else falls through to the app's own fake replies.
import * as faux from "@earendil-works/pi-ai/providers/faux";

export * from "@earendil-works/pi-ai/providers/faux";

const { fauxAssistantMessage: msg, fauxText: text, fauxToolCall: call } = faux;
const toolUse = (message) => ({ ...message, stopReason: "toolUse" });

const textOf = (m) =>
  !m
    ? ""
    : typeof m.content === "string"
      ? m.content
      : m.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");

// One scene per CAST.md chat: `match` is the owner's message, `steps` are the
// model's turns (step 2 runs after step 1's tool call has its result).
const SCENES = [
  {
    // Researcher
    match: /^Find beach hostels in Goa under ₹1,500 a night\./,
    steps: [
      () =>
        msg(
          text(
            [
              "Your report is ready. Three areas fit the budget:",
              "",
              "- Palolem: quiet beach, ₹900 to ₹1,400",
              "- Anjuna: lively, ₹700 to ₹1,200",
              "- Arambol: long stays, ₹600 to ₹1,100",
            ].join("\n"),
          ),
        ),
    ],
  },
  {
    // Chief of Staff: the create_bot approval card, then the reply once it ran.
    match: /^Make me an Expense Tracker bot\. Log receipts I send it\./,
    steps: [
      () =>
        toolUse(
          msg([
            text("Expense Tracker is ready for your OK."),
            call("create_bot", {
              name: "Expense Tracker",
              description: "Logs receipts and totals your spend",
              instructions:
                "You are Expense Tracker. When Ashik sends a receipt photo or an amount, record the date, merchant, amount and category. Reply with the running total for the month. Ask before you change or delete an entry.",
            }),
          ]),
        ),
      () => msg(text("Expense Tracker has joined the team. Send it a receipt to try it.")),
    ],
  },
  {
    // Code Buddy: plain messages in this instance (the hand-off is staged elsewhere).
    match: /^The checkout test is flaky\. Fix it and run the suite\./,
    steps: [
      () => msg(text("Fixed. All 48 tests pass. The change is on branch fix/checkout-flake.")),
    ],
  },
  {
    // Travel Planner: plain messages plus one real pending approval. The
    // vault card is staged elsewhere; here the bot asks to create its CAST
    // routine, which needs no sandbox and never expires.
    match: /^Check Chennai to Goa fares for Friday\./,
    steps: [
      () =>
        toolUse(
          msg([
            text(
              "Goa fares dropped ₹4,200. The 6:15 AM nonstop on Friday is ₹5,840, under your ₹6,000 limit, so I'm booking two seats.",
            ),
            call("create_routine", {
              name: "Morning fare check",
              prompt: "Check Chennai to Goa fares for Friday.",
              schedule: { kind: "cron", expr: "0 7 * * *" },
            }),
          ]),
        ),
      () => msg(text("Done. You're in 14A and 14B.")),
    ],
  },
];

/** The CAST reply for this request, or undefined when no scene matches. */
function director(context) {
  const messages = context.messages;
  const sceneIndex = messages.findLastIndex(
    (m) => m.role === "user" && SCENES.some((s) => s.match.test(textOf(m))),
  );
  if (sceneIndex < 0) return undefined;
  // A later owner message that is not a scene belongs to the app's fake model.
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  if (lastUser > sceneIndex) return undefined;
  const scene = SCENES.find((s) => s.match.test(textOf(messages[sceneIndex])));
  const done = messages.slice(sceneIndex + 1).filter((m) => m.role === "assistant").length;
  return scene.steps[Math.min(done, scene.steps.length - 1)]();
}

export function fauxProvider(options = {}) {
  const handle = faux.fauxProvider(options);
  if (options.provider !== "faux") return handle;
  const setResponses = handle.setResponses.bind(handle);
  // The app queues its own reply function many times over; ours goes first.
  handle.setResponses = (responses) =>
    setResponses(
      responses.map(
        (own) =>
          (context, ...rest) =>
            director(context) ?? (typeof own === "function" ? own(context, ...rest) : own),
      ),
    );
  return handle;
}
