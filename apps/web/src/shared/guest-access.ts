type Methods = readonly string[] | "*";

export type UploadReach = "uploaded" | "uploadedOrShared";

type GuestApiRule =
  | { methods: Methods; path: RegExp }
  | { methods: Methods; bot: RegExp }
  | { methods: Methods; upload: RegExp; reach: UploadReach };

interface GuestFeature {
  page?: `/${string}`;
  api: readonly GuestApiRule[];
}

const READ: readonly string[] = ["GET", "HEAD"];

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
      { methods: READ, bot: /^\/(browser|computer)$/ },
      { methods: ["POST"], bot: /^\/(browser|computer)\/vnc-ticket$/ },
    ],
  },
  uploads: {
    api: [
      { methods: ["POST"], path: /^\/uploads$/ },
      { methods: READ, upload: /^(\/(content|text))?$/, reach: "uploadedOrShared" },
      { methods: ["DELETE"], upload: /^$/, reach: "uploaded" },
    ],
  },
};

export const BOT_PATH = /^\/bots\/([^/]+)(\/.*)?$/;

export const UPLOAD_PATH = /^\/uploads\/([^/]+)(\/.*)?$/;

const GUEST_PAGES = Object.values(GUEST_ACCESS).flatMap((feature) =>
  feature.page ? [feature.page] : [],
);

export function isGuestPage(path: string): boolean {
  return GUEST_PAGES.some((page) => path === page || path.startsWith(`${page}/`));
}
