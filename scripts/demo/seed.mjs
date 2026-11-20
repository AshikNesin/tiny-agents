const BASE = "http://localhost:3000/api/v1";

const login = await fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "demo@example.com", password: "demo@example.com" }), // gitleaks:allow
}).then((r) => r.json());
const auth = { authorization: `Bearer ${login.data.token}`, "content-type": "application/json" };

async function api(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: auth,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json.data;
}

const day = (offset, hour = 17) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function waitIdle() {
  for (let i = 0; i < 120; i++) {
    const bots = await api("GET", "/bots");
    if (!bots.some((b) => b.replying)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("bots never went idle");
}

const BOTS = [
  {
    key: "code",
    name: "Code Buddy",
    description: "Pair-programs with you and explains bugs",
    modelId: "claude-sonnet-5-5",
    systemPrompt: "You are a calm senior engineer. Explain the why, show minimal code.",
  },
  {
    key: "fitness",
    name: "Fitness Coach",
    description: "Workouts and habits that actually stick",
    modelId: "claude-haiku-5-5",
    systemPrompt: "You are an encouraging coach. Short plans, no equipment unless asked.",
  },
  {
    key: "writer",
    name: "Writer",
    description: "Drafts posts, emails and announcements",
    modelId: "claude-sonnet-5-5",
    systemPrompt: "You write crisp, warm copy. Lead with the point.",
  },
  {
    key: "research",
    name: "Researcher",
    description: "Digs into questions and compares options",
    modelId: "claude-sonnet-5-5",
    systemPrompt: "You research before answering and cite sources.",
  },
  {
    key: "chief",
    name: "Chief of Staff",
    description: "Keeps your day and routines on track",
    modelId: "claude-opus-5-5",
    systemPrompt: "You run the owner's day: tasks, routines and follow-ups. Be brief.",
  },
];

const bots = {};
for (const bot of BOTS) {
  const { key, ...payload } = bot;
  bots[key] = await api("POST", "/bots", payload);
}
await api("POST", `/bots/${bots.chief.id}/pin`, { pinned: true });
await api("PATCH", `/bots/${bots.chief.id}`, {
  toolPermissions: { create_task: "allow", create_routine: "allow" },
});
await api("PATCH", `/bots/${bots.research.id}`, {
  toolPermissions: {
    browser_navigate: "allow",
    browser_scroll: "allow",
    browser_snapshot: "allow",
  },
});
await api("PATCH", `/bots/${bots.code.id}`, { toolPermissions: { run_command: "allow" } });
await api("POST", `/bots/${bots.research.id}/pin`, { pinned: true });

await api("POST", `/bots/${bots.fitness.id}/messages`, {
  requestId: crypto.randomUUID(),
  text: "Give me a 20-minute workout I can do at home",
});
await waitIdle();
await api("POST", `/bots/${bots.code.id}/messages`, {
  requestId: crypto.randomUUID(),
  text: "Why does my effect run twice in React?",
});
await waitIdle();

for (const task of [
  { title: "Prepare Q4 planning deck", priority: "high", dueAt: day(0) },
  { title: "Reply to Maya about the offsite", priority: "medium", dueAt: day(0, 15) },
  { title: "Renew passport", priority: "medium", dueAt: day(3) },
  { title: "Outline the v2 launch blog post", priority: "low", dueAt: day(6) },
  { title: "Review design system tokens", priority: "low" },
]) {
  await api("POST", "/tasks", task);
}
const paid = await api("POST", "/tasks", { title: "Pay the electricity bill", priority: "medium" });
await api("PATCH", `/tasks/${paid.id}`, { status: "done" });

for (const routine of [
  {
    botId: bots.chief.id,
    name: "Weekly review",
    prompt: "Summarize my week: wins, slips and the top three priorities for next week.",
    schedule: { kind: "cron", expr: "0 17 * * 5" },
  },
  {
    botId: bots.fitness.id,
    name: "Gym check-in",
    prompt: "Check in on today's workout and suggest a quick plan.",
    schedule: { kind: "cron", expr: "30 7 * * 1,3,5" },
  },
  {
    botId: bots.research.id,
    name: "AI news digest",
    prompt: "Give me the five most important AI stories from the past week, with sources.",
    schedule: { kind: "cron", expr: "0 8 * * 1" },
  },
]) {
  await api("POST", "/routines", routine);
}

for (const [key, memories] of Object.entries({
  chief: [
    { text: "Prefers meetings after 10am", category: "preference" },
    { text: "Works at a 12-person design studio", category: "fact" },
    { text: "Wants to ship the v2 launch before December", category: "goal" },
  ],
  fitness: [
    { text: "Runs three mornings a week", category: "habit" },
    { text: "Is training for a 10K in spring", category: "goal" },
  ],
  research: [{ text: "Likes comparisons as short tables", category: "preference" }],
  writer: [{ text: "Writes in a warm, plain-spoken voice", category: "preference" }],
})) {
  for (const memory of memories) await api("POST", `/bots/${bots[key].id}/memories`, memory);
}

for (const skill of [
  {
    name: "meeting-notes",
    description: "Turn raw meeting notes into decisions, owners and next steps.",
    body: "# Meeting notes\n\n1. List decisions.\n2. Assign owners.\n3. Close with next steps and dates.",
    botIds: [bots.chief.id],
  },
  {
    name: "trip-itinerary",
    description: "Day-by-day itineraries with food, sights and realistic timing.",
    body: "# Trip itinerary\n\nPlan each day around one neighborhood, a long lunch and a sunset spot.",
    botIds: [],
  },
  {
    name: "weekly-review",
    description: "A calm Friday review of wins, slips and next week's focus.",
    body: "# Weekly review\n\nWins · Slips · Lessons · Top 3 for next week.",
    botIds: [bots.chief.id],
  },
]) {
  await api("POST", "/skills", skill);
}

console.log(JSON.stringify(Object.fromEntries(Object.entries(bots).map(([k, b]) => [k, b.id]))));
