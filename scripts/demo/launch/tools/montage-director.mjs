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

const SCENES = [
  {
    match: /beach hostels in goa/i,
    steps: [
      () => toolUse(msg(call("web_search", { query: "Goa beach hostels under ₹1,500 a night" }))),
      () =>
        toolUse(msg(call("web_search", { query: "Palolem, Anjuna and Arambol hostel prices" }))),
      () => toolUse(msg(call("web_fetch", { url: "https://hostels.example.com/goa" }))),
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
    match: /window seats/i,
    steps: [
      () =>
        toolUse(
          msg([
            call("remember", { text: "Prefers window seats", category: "preference" }),
            call("remember", {
              text: "Flight budget: under ₹6,000 one way",
              category: "preference",
            }),
            call("remember", { text: "Travels with Sonaal", category: "fact" }),
          ]),
        ),
      () => msg(text("Saved. I'll plan every trip around those.")),
    ],
  },
  {
    match: /code\/shop/i,
    steps: [
      () =>
        toolUse(msg(call("remember", { text: "Works in the ~/code/shop repo", category: "fact" }))),
      () => msg(text("Saved. I'll start in ~/code/shop.")),
    ],
  },
];

function director(context) {
  const messages = context.messages;
  const start = messages.findLastIndex(
    (m) => m.role === "user" && SCENES.some((s) => s.match.test(textOf(m))),
  );
  const scene = start >= 0 ? SCENES.find((s) => s.match.test(textOf(messages[start]))) : undefined;
  if (!scene) return msg(text("Okay."));
  const done = messages.slice(start + 1).filter((m) => m.role === "assistant").length;
  return scene.steps[Math.min(done, scene.steps.length - 1)]();
}

export function fauxProvider(options = {}) {
  const registration = faux.fauxProvider(options);
  if (options.provider !== "faux") return registration;
  const setResponses = registration.setResponses.bind(registration);
  registration.setResponses = () => setResponses(Array.from({ length: 5000 }, () => director));
  return registration;
}
