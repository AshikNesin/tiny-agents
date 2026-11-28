import { execSync } from "node:child_process";
import * as faux from "@earendil-works/pi-ai/providers/faux";

export * from "@earendil-works/pi-ai/providers/faux";

const { fauxAssistantMessage: msg, fauxText: text, fauxThinking: think, fauxToolCall: call } = faux;

const DEMO_MODELS = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", reasoning: true, contextWindow: 200_000 },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true, contextWindow: 200_000 },
  { id: "gpt-5.4", name: "GPT-5.4", reasoning: true, contextWindow: 400_000 },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", reasoning: true, contextWindow: 200_000 },
];

export function fridayDate() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
export const FLIGHTS_URL = () =>
  `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights to BLR from MAA on ${fridayDate()} one way`)}&curr=INR&hl=en&gl=IN`;

async function liveFlights() {
  const port = execSync(
    "ps -u exedev -o args= | grep -o -- '--remote-debugging-port=[0-9]*' | head -1 | cut -d= -f2",
  )
    .toString()
    .trim();
  if (!port) return [];
  for (let attempt = 0; attempt < 16; attempt++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((t) => t.type === "page" && t.url.includes("/travel/flights"));
    if (target) {
      const labels = await evaluate(
        target.webSocketDebuggerUrl,
        `[...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).filter((t) => /Indian rupees/.test(t) && /Leaves/.test(t))`,
      );
      const flights = (labels ?? []).map(parseFlight).filter(Boolean);
      if (flights.length > 0) return flights;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
}

function evaluate(wsUrl, expression) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const done = (value) => {
      ws.close();
      resolve(value);
    };
    setTimeout(() => done(undefined), 4000);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      );
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) done(message.result?.result?.value);
    };
    ws.onerror = () => done(undefined);
  });
}

function parseFlight(label) {
  const price = label.match(/From ([\d,]+) Indian rupees/);
  const airline = label.match(/flight with ([^.]+)\./);
  const leaves = label.match(/Leaves .*? at (\d{1,2}:\d{2}\s?[AP]M)/);
  const arrives = label.match(/arrives .*? at (\d{1,2}:\d{2}\s?[AP]M)/);
  const duration = label.match(/Total duration ([^.]+)\./);
  const stops = label.match(/(Nonstop|\d+ stops?) flight/);
  if (!price || !airline || !leaves) return undefined;
  const [, hm, ap] = leaves[1].match(/(\d{1,2}):\d{2}\s?([AP]M)/);
  const hour = (Number(hm) % 12) + (ap === "PM" ? 12 : 0);
  return {
    price: Number(price[1].replace(/,/g, "")),
    airline: airline[1].replace(/ and .*/, ""),
    leaves: leaves[1].replace(/\s/, " "),
    arrives: arrives?.[1].replace(/\s/, " "),
    duration: duration?.[1],
    stops: stops?.[1] ?? "",
    hour,
  };
}

async function flightAnswer() {
  const flights = await liveFlights();
  const evening = flights.filter((f) => f.hour >= 16);
  const pool = evening.length > 0 ? evening : flights;
  const best = pool.sort((a, b) => a.price - b.price)[0];
  if (!best) {
    return msg(
      text(
        "Here are Friday's flights from Chennai to Bengaluru on Google Flights — they're in the panel on the right. Want me to keep an eye on the fares?",
      ),
    );
  }
  const rupees = `₹${best.price.toLocaleString("en-IN")}`;
  const times = best.arrives ? `${best.leaves} → ${best.arrives}` : best.leaves;
  return msg(
    text(
      [
        `Best Friday-evening pick: **${best.airline}, ${times}** — ${best.stops.toLowerCase()}${best.duration ? `, ${best.duration}` : ""}, **${rupees}**.`,
        "",
        `That's the cheapest of ${pool.length} evening flights on Google Flights right now. Want me to keep an eye on the fare?`,
      ].join("\n"),
    ),
  );
}

const textOf = (m) =>
  !m
    ? ""
    : typeof m.content === "string"
      ? m.content
      : m.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");

const toolUse = (m) => ({ ...m, stopReason: "toolUse" });

const SCENES = [
  {
    match: /weekend in bangalore/i,
    steps: [
      () =>
        toolUse(
          msg([
            call("ask_owner", {
              questions: [
                {
                  question: "What's the vibe for the weekend?",
                  options: [
                    { label: "Food & cafés", description: "Dosas, filter coffee, breweries" },
                    { label: "Nature & day trips", description: "Nandi Hills, Lalbagh" },
                    { label: "Culture & history", description: "Palaces, museums, markets" },
                  ],
                },
                {
                  question: "What should I prioritize?",
                  description: "Pick as many as you like.",
                  options: [
                    { label: "Great food" },
                    { label: "Easy to get around" },
                    { label: "Early mornings" },
                    { label: "Nightlife" },
                  ],
                  multiple: true,
                },
                {
                  question: "Budget per night?",
                  options: [
                    { label: "Under ₹4,000" },
                    { label: "₹4,000–8,000" },
                    { label: "₹8,000+" },
                  ],
                },
              ],
            }),
          ]),
        ),
      () =>
        msg([
          think(
            "Food first, early starts welcome, mid-range stay: Basavanagudi eats, a Nandi Hills sunrise, Indiranagar base.",
          ),
          text(
            [
              "Perfect — here's a **food-first weekend in Bangalore**, with one early start:",
              "",
              "**Saturday · Basavanagudi & VV Puram**",
              "- Masala dosa and filter coffee at Vidyarthi Bhavan",
              "- A morning walk through Lalbagh Botanical Garden",
              "- Evening street-food crawl on VV Puram Food Street",
              "",
              "**Sunday · Nandi Hills sunrise**",
              "- Leave by 4:30 am for sunrise at Nandi Hills (about 60 km)",
              "- Back for a classic breakfast at MTR",
              "- Craft beer and dinner in Indiranagar",
              "",
              "**Stay:** Indiranagar — walkable, great food and right on the metro, with plenty of stays in your ₹4,000–8,000 range.",
            ].join("\n"),
          ),
        ]),
    ],
  },
  {
    match: /flight from chennai/i,
    steps: [
      () =>
        toolUse(
          msg([
            think(
              "Check live fares for Friday evening, MAA → BLR. Google Flights has the full list.",
            ),
            call("web_search", { query: "Chennai to Bangalore flights Friday evening" }),
          ]),
        ),
      () => toolUse(msg(call("browser_navigate", { url: FLIGHTS_URL() }))),
      () => toolUse(msg(call("browser_scroll", { direction: "down", amount: 700 }))),
      () => flightAnswer(),
    ],
  },
  {
    match: /best time to visit lisbon/i,
    steps: [
      () =>
        toolUse(
          msg([
            think("Seasonality question. Search first, then read the climate section directly."),
            call("web_search", { query: "best time to visit Lisbon" }),
          ]),
        ),
      () =>
        toolUse(
          msg(call("browser_navigate", { url: "https://en.wikipedia.org/wiki/Lisbon#Climate" })),
        ),
      () =>
        msg(
          text(
            [
              "**Go in late spring (April–June) or early autumn (September–October).**",
              "",
              "- Summers are hot, dry and busy; winters are mild but wetter.",
              "- Spring and early autumn are warm, sunny and far less crowded.",
              "",
              "Source: Wikipedia — Lisbon, *Climate*.",
            ].join("\n"),
          ),
        ),
    ],
  },
  {
    match: /run the tests/i,
    steps: [
      () => toolUse(msg(call("run_command", { command: "cd ~/acme-shop && npm test" }))),
      () =>
        msg(
          text(
            [
              "All **6 tests pass** ✅ — totals, the SAVE10 coupon and rounding are covered.",
              "",
              "The new euro formatter in `src/format.js` has no test yet. Want me to add one?",
            ].join("\n"),
          ),
        ),
    ],
  },
  {
    match: /note-taking/i,
    steps: [
      () =>
        toolUse(
          msg([
            think(
              "They want a recommendation for a 5-person team. Collaboration, offline access and price matter most at that size. Let me check what's current before comparing.",
            ),
            call("web_search", { query: "best note-taking apps for small teams 2026" }),
          ]),
        ),
      () =>
        msg([
          think(
            "Three stand out: Notion for an all-in-one hub, Obsidian for local-first, Craft for polish.",
          ),
          text(
            [
              "Here's how the three strongest options stack up for a 5-person team:",
              "",
              "| App | Best for | Offline |",
              "| --- | --- | --- |",
              "| **Notion** | One hub for docs, wikis and projects | Partial |",
              "| **Obsidian** | A private, local-first knowledge base | Full |",
              "| **Craft** | Polished docs you share with clients | Full |",
              "",
              "**My pick:** Notion if you want one shared hub for docs and projects. Choose Obsidian if privacy and offline matter most.",
              "",
              "Want me to plan a two-week trial for the team?",
            ].join("\n"),
          ),
        ]),
    ],
  },
  {
    match: /weekend in portugal/i,
    steps: [
      () =>
        toolUse(
          msg([
            call("ask_owner", {
              questions: [
                {
                  question: "What kind of trip are you after?",
                  options: [
                    { label: "City & food", description: "Lisbon or Porto" },
                    { label: "Beaches", description: "The Algarve coast" },
                    { label: "Wine country", description: "Douro Valley" },
                  ],
                },
                {
                  question: "What should I prioritize?",
                  description: "Pick as many as you like.",
                  options: [
                    { label: "Great food" },
                    { label: "Walkable" },
                    { label: "Day trips" },
                    { label: "Nightlife" },
                  ],
                  multiple: true,
                },
                {
                  question: "Budget per night?",
                  options: [{ label: "Under €100" }, { label: "€100–200" }, { label: "€200+" }],
                },
              ],
            }),
          ]),
        ),
      () =>
        msg([
          think(
            "City & food, great food plus day trips, mid-range budget: Lisbon with a Sintra day trip fits perfectly.",
          ),
          text(
            [
              "Perfect — here's a **3-day Lisbon** plan built around food, with one easy day trip:",
              "",
              "**Day 1 · Alfama & Baixa**",
              "- Pastéis de nata at Manteigaria, then wander Alfama's alleys",
              "- Sunset at Miradouro da Senhora do Monte",
              "- Dinner: petiscos at Taberna da Rua das Flores",
              "",
              "**Day 2 · Sintra day trip**",
              "- Early train from Rossio (40 min) to Pena Palace",
              "- Lunch in Sintra village, back for dinner in Príncipe Real",
              "",
              "**Day 3 · Belém & LX Factory**",
              "- Jerónimos Monastery and the riverside walk",
              "- Time Out Market for a long, lazy lunch",
              "",
              "**Stay:** Memmo Príncipe Real or The Lumiares — both in your €100–200 range.",
            ].join("\n"),
          ),
        ]),
    ],
  },
  {
    match: /every weekday at 9/i,
    steps: [
      () =>
        toolUse(
          msg([
            think("A weekday 9:00 routine: the day ahead plus Friday's MAA → BLR fares."),
            call("create_routine", {
              name: "Morning briefing",
              prompt:
                "Brief me on my day, then check Friday's Chennai → Bangalore fares and flag any drop below ₹4,000.",
              schedule: { kind: "cron", expr: "0 9 * * 1-5" },
            }),
          ]),
        ),
      () =>
        msg(
          text(
            [
              "Done ✅ **Morning briefing** runs every weekday at 9:00:",
              "",
              "- Your day at a glance",
              "- Friday's Chennai → Bangalore fares, flagged if one drops below ₹4,000",
              "",
              "Your first briefing lands tomorrow morning.",
            ].join("\n"),
          ),
        ),
    ],
  },
  {
    match: /launch announcement/i,
    steps: [
      () =>
        msg([
          think("A short, upbeat announcement: what it is, three highlights, a call to action."),
          text(
            [
              "## Meet tiny-agents 👋",
              "",
              "Your own team of always-on AI bots, in a messenger you already know how to use.",
              "",
              "Every contact is a bot with its own persona, model and tools. Ask your **Researcher** to dig into a question, let your **Chief of Staff** run your routines, and hand off between them with a simple @mention.",
              "",
              "**Why you'll love it**",
              "",
              "- **Durable by design** — replies survive refreshes, crashes and redeploys, and pick up right where they left off.",
              "- **You stay in control** — bots ask before they act, and ask you questions instead of guessing.",
              "- **Remembers what matters** — preferences, routines and skills carry across every chat.",
              "",
              "Spin up your first bot in under a minute. Your team is waiting.",
            ].join("\n"),
          ),
        ]),
    ],
  },
  {
    match: /workout/i,
    steps: [
      () =>
        msg(
          text(
            [
              "Here's a 20-minute, no-equipment routine 💪",
              "",
              "1. **Warm-up (3 min)** — jumping jacks, arm circles",
              "2. **Circuit ×3 (14 min)** — 12 squats · 10 push-ups · 30 s plank · 12 lunges",
              "3. **Cool-down (3 min)** — hamstring and hip stretches",
              "",
              "Want me to schedule it for Monday, Wednesday and Friday mornings?",
            ].join("\n"),
          ),
        ),
    ],
  },
  {
    match: /effect run(s|ning) twice/i,
    steps: [
      () =>
        msg(
          text(
            [
              "That's React **StrictMode** in development: it mounts, unmounts and re-mounts components to surface missing cleanups.",
              "",
              "```tsx",
              "useEffect(() => {",
              "  const id = setInterval(tick, 1000);",
              "  return () => clearInterval(id); // cleanup makes it idempotent",
              "}, []);",
              "```",
              "",
              "It only happens in dev — production runs the effect once.",
            ].join("\n"),
          ),
        ),
    ],
  },
];

function fallback(userText) {
  return msg(text(`On it! Here's my take on “${userText.slice(0, 80)}” — I'll keep you posted.`));
}

function director(context) {
  const messages = context.messages;
  const lastUser = messages.findLastIndex((m) => m.role === "user");
  const userText = textOf(messages[lastUser]);
  const sceneIndex = messages.findLastIndex(
    (m) => m.role === "user" && SCENES.some((s) => s.match.test(textOf(m))),
  );
  const scene =
    sceneIndex >= 0 ? SCENES.find((s) => s.match.test(textOf(messages[sceneIndex]))) : undefined;
  if (!scene) return fallback(userText);
  const results = messages.slice(sceneIndex + 1).filter((m) => m.role === "assistant").length;
  const step = scene.steps[Math.min(results, scene.steps.length - 1)];
  if (results >= scene.steps.length && lastUser > sceneIndex) return fallback(userText);
  return step();
}

export function fauxProvider(options = {}) {
  if (options.provider !== "faux") return faux.fauxProvider(options);
  const tokensPerSecond = Number(process.env.DEMO_TOKENS_PER_SECOND) || 55;
  const registration = faux.fauxProvider({ ...options, models: DEMO_MODELS, tokensPerSecond });
  const setResponses = registration.setResponses.bind(registration);
  registration.setResponses = () => setResponses(Array.from({ length: 5000 }, () => director));
  return registration;
}
