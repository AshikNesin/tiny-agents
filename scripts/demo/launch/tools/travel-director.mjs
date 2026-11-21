import { appendFileSync } from "node:fs";
import * as faux from "@earendil-works/pi-ai/providers/faux";

export * from "@earendil-works/pi-ai/providers/faux";

const { fauxAssistantMessage: msg, fauxText: text, fauxToolCall: call } = faux;
const toolUse = (message) => ({ ...message, stopReason: "toolUse" });

export const FLIGHTS_URL = "https://flights.example.com/search?from=MAA&to=GOI";
export const ROUTINE_PROMPT = "Check Chennai to Goa fares for Friday.";
export const FARE_LINE =
  "Goa fares dropped ₹4,200. The 6:15 AM nonstop on Friday is ₹5,840, under your ₹6,000 limit, so I'm booking two seats.";
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

const SCENES = [
  {
    match: has(ROUTINE_PROMPT),
    steps: [
      () => toolUse(msg(call("browser_navigate", { url: FLIGHTS_URL }))),
      () => msg(text(FARE_LINE)),
    ],
  },
  {
    match: has(BOOK_TRIGGER),
    steps: [
      () =>
        toolUse(
          msg([text(FARE_LINE), call("browser_fill_secret", { handle: "visa", field: "card" })]),
        ),
      () => msg(text("[skip]")),
    ],
  },
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
