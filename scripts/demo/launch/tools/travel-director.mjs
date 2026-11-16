// Scripts the fake model for the travel staging instance (stage-travel.mjs):
// the Travel Planner says the CAST.md lines and makes real tool calls, so the
// routine run opens the fares page in the bot's real browser and the chat
// waits on a real vault approval card. Anything else (side calls, titles)
// falls through to the app's own fake replies.
import { appendFileSync } from "node:fs";
import * as faux from "@earendil-works/pi-ai/providers/faux";

export * from "@earendil-works/pi-ai/providers/faux";

const { fauxAssistantMessage: msg, fauxText: text, fauxToolCall: call } = faux;
const toolUse = (message) => ({ ...message, stopReason: "toolUse" });

export const FLIGHTS_URL = "https://flights.example.com/search?from=MAA&to=GOI";
export const ROUTINE_PROMPT = "Check Chennai to Goa fares for Friday.";
export const FARE_LINE =
  "Goa fares dropped ₹4,200. The 6:15 AM nonstop on Friday is ₹5,840, under your ₹6,000 limit, so I'm booking two seats.";
/** The owner's message that starts the booking turn in the chat (hidden in the snapshots). */
export const BOOK_TRIGGER = "Book the Friday 6:15 fare for two.";
export const ASHIK_SHARED = "Sonaal, we're booked for Friday 6:15!";
export const SONAAL_SHARED = "Yes!! Window seats please?";
export const SEATS_LINE = "Done. You're in 14A and 14B.";

const textOf = (m) =>
  !m
    ? ""
    : typeof m.content === "string"
      ? m.content
      : m.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");

const has = (needle) => (s) => s.includes(needle);

// `match` tests the latest user message; `steps` are the model's turns in
// order (step n runs after n assistant messages followed that message).
const SCENES = [
  {
    // The routine's own conversation: open the fares page, then report.
    match: has(ROUTINE_PROMPT),
    steps: [
      () => toolUse(msg(call("browser_navigate", { url: FLIGHTS_URL }))),
      () => msg(text(FARE_LINE)),
    ],
  },
  {
    // The chat: the CAST line and the card fill, which waits on the vault card.
    match: has(BOOK_TRIGGER),
    steps: [
      () =>
        toolUse(
          msg([text(FARE_LINE), call("browser_fill_secret", { handle: "visa", field: "card" })]),
        ),
      // After the fill: nothing more to say (CAST has no line here).
      () => msg(text("[skip]")),
    ],
  },
  // The shared chat: the bot answers only Sonaal's question.
  { match: has(ASHIK_SHARED), steps: [() => msg(text("[skip]"))] },
  { match: has(SONAAL_SHARED), steps: [() => msg(text(SEATS_LINE))] },
];

function director(context) {
  const messages = context.messages ?? [];
  if (process.env.TRAVEL_DIRECTOR_LOG) {
    const last = messages.findLast((m) => m.role === "user");
    appendFileSync(
      process.env.TRAVEL_DIRECTOR_LOG,
      `${JSON.stringify({ n: messages.length, last: textOf(last).slice(0, 100) })}\n`,
    );
  }
  const last = messages.findLastIndex((m) => m.role === "user");
  if (last < 0) return undefined;
  const scene = SCENES.find((s) => s.match(textOf(messages[last])));
  if (!scene) return undefined;
  const done = messages.slice(last + 1).filter((m) => m.role === "assistant").length;
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
