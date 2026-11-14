export function searchResults(query) {
  if (/chennai/i.test(query)) {
    return [
      {
        title: "Chennai (MAA) to Bengaluru (BLR) flights | Google Flights",
        url: "https://www.google.com/travel/flights",
        description: "Compare fares and nonstop flights on the MAA–BLR route.",
      },
      {
        title: "Cheap flights from Chennai to Bengaluru | Skyscanner",
        url: "https://www.skyscanner.co.in/routes/maa/blr/chennai-to-bengaluru.html",
        description: "Fares by day, airlines on the route and flight times.",
      },
      {
        title: "Chennai to Bengaluru flight schedule | IndiGo",
        url: "https://www.goindigo.in",
        description: "Daily nonstop departures between MAA and BLR.",
      },
    ];
  }
  if (/lisbon/i.test(query)) {
    return [
      {
        title: "Lisbon - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Lisbon",
        description: "Capital of Portugal on the Tagus estuary, with a Mediterranean climate.",
      },
      {
        title: "Visit Lisboa | official tourism site",
        url: "https://www.visitlisboa.com/en",
        description: "Seasons, events and neighborhoods across the year.",
      },
      {
        title: "Lisbon travel guide | Lonely Planet",
        url: "https://www.lonelyplanet.com/portugal/lisbon",
        description: "When to go, where to stay and what to eat.",
      },
    ];
  }
  return [
    {
      title: "Notion for teams | docs, wikis and projects in one place",
      url: "https://www.notion.com/product/teams",
      description: "Connected workspace with databases, templates and real-time collaboration.",
    },
    {
      title: "Obsidian | sharpen your thinking",
      url: "https://obsidian.md",
      description: "Private, local-first markdown notes with Sync and Publish add-ons for teams.",
    },
    {
      title: "Craft | docs that look great",
      url: "https://www.craft.do",
      description: "Beautiful documents, fast sharing and collaborative spaces.",
    },
    {
      title: "The best note-taking apps for small teams in 2026",
      url: "https://zapier.com/blog/best-note-taking-apps",
      description: `Hands-on comparison: ${query}`,
    },
  ];
}
