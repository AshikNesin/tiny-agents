type GuestApiRule = {
  methods: readonly string[] | "*";
  /** Matched against the path under `/api/v1`. A `(?<bot>…)` group must be a bot shared with the guest. */
  path: RegExp;
};

interface GuestFeature {
  page?: `/${string}`;
  api: readonly GuestApiRule[];
}

const READ: readonly string[] = ["GET", "HEAD"];

/** Default-deny (issue #145): a page or API route is the owner's until a feature here lists it. */
export const GUEST_ACCESS = {
  account: { page: "/settings", api: [{ methods: READ, path: /^\/people\/me$/ }] },
  app: {
    api: [{ methods: READ, path: /^\/(models|capabilities|claude-code\/status|events)$/ }],
  },
  chats: {
    page: "/chats",
    api: [
      { methods: READ, path: /^\/bots$/ },
      { methods: READ, path: /^\/bots\/(?<bot>[^/]+)$/ },
      {
        methods: "*",
        path: /^\/bots\/(?<bot>[^/]+)\/(stream|messages(\/[^/]+)?|abort|read|approvals\/\d+|questions\/\d+)$/,
      },
    ],
  },
  liveViews: {
    api: [
      {
        methods: [...READ, "POST"],
        path: /^\/bots\/(?<bot>[^/]+)\/(browser|computer)(\/(start|vnc-ticket|resize|driver))?$/,
      },
    ],
  },
  uploads: { api: [{ methods: "*", path: /^\/uploads(\/.*)?$/ }] },
  code: { page: "/code", api: [{ methods: "*", path: /^\/code(\/.*)?$/ }] },
} satisfies Record<string, GuestFeature>;

const GUEST_PAGES = Object.values(GUEST_ACCESS).flatMap((feature: GuestFeature) =>
  feature.page ? [feature.page] : [],
);

export function isGuestPage(path: string): boolean {
  return GUEST_PAGES.some((page) => path === page || path.startsWith(`${page}/`));
}
