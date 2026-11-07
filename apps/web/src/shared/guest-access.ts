type Methods = readonly string[] | "*";

/**
 * The uploads a rule reaches: those the guest uploaded, or also those sent in
 * the chat of a bot shared with them.
 */
export type UploadReach = "uploaded" | "uploadedOrShared";

type GuestApiRule =
  /** `path` is matched against the path under `/api/v1`, and never admits a `/bots/<id>` or `/uploads/<id>` path. */
  | { methods: Methods; path: RegExp }
  /** `bot` is matched against what follows `/bots/<id>`; the bot must be shared with the guest. */
  | { methods: Methods; bot: RegExp }
  /** `upload` is matched against what follows `/uploads/<id>`; the guest must reach the upload. */
  | { methods: Methods; upload: RegExp; reach: UploadReach };

interface GuestFeature {
  page?: `/${string}`;
  api: readonly GuestApiRule[];
}

const READ: readonly string[] = ["GET", "HEAD"];

/** Default-deny (issue #145): a page or API route is the owner's until a feature here lists it. */
export const GUEST_ACCESS: Record<string, GuestFeature> = {
  account: { page: "/settings", api: [{ methods: READ, path: /^\/people\/me$/ }] },
  app: {
    api: [{ methods: READ, path: /^\/(models|capabilities|claude-code\/status|events)$/ }],
  },
  chats: {
    page: "/chats",
    api: [
      { methods: READ, path: /^\/bots$/ },
      { methods: READ, bot: /^$/ },
      {
        methods: "*",
        bot: /^\/(stream|messages(\/[^/]+)?|abort|read|approvals\/\d+|questions\/\d+)$/,
      },
    ],
  },
  liveViews: {
    api: [
      {
        methods: [...READ, "POST"],
        bot: /^\/(browser|computer)(\/(start|vnc-ticket|resize|driver))?$/,
      },
    ],
  },
  uploads: {
    api: [
      { methods: ["POST"], path: /^\/uploads$/ },
      { methods: READ, upload: /^(\/(content|text))?$/, reach: "uploadedOrShared" },
      { methods: ["DELETE"], upload: /^$/, reach: "uploaded" },
    ],
  },
  code: { page: "/code", api: [{ methods: "*", path: /^\/code(\/.*)?$/ }] },
};

/** A `/bots/<id>` path: the bot id, then the rest of the path. */
export const BOT_PATH = /^\/bots\/([^/]+)(\/.*)?$/;

/** An `/uploads/<id>` path: the upload id, then the rest of the path. */
export const UPLOAD_PATH = /^\/uploads\/([^/]+)(\/.*)?$/;

const GUEST_PAGES = Object.values(GUEST_ACCESS).flatMap((feature) =>
  feature.page ? [feature.page] : [],
);

export function isGuestPage(path: string): boolean {
  return GUEST_PAGES.some((page) => path === page || path.startsWith(`${page}/`));
}
